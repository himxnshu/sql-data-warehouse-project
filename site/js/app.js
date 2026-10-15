/**
 * Enterprise Sales Data Warehouse · Executive SaaS Controller
 * Inspired by AeuxGlobal Modern SaaS Dashboard (Image 3)
 * Author: Himanshu Sharma
 */

// ---------------------------------------------------------------------------
// Global Application State
// ---------------------------------------------------------------------------
const APP_STATE = {
  currentView: 'view-dashboard',
  selectedCatalogTable: 'gold.dim_customers',
  selectedJourneyStep: 1,
  selectedDiff: 'customers',
  selectedSqlQueryId: 'q1',
  filteredCountry: 'ALL',
  filteredCategory: 'ALL',
  apiBaseUrl: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : '',
  isApiLive: false
};

// ---------------------------------------------------------------------------
// Page Titles and Metadata
// ---------------------------------------------------------------------------
const VIEW_METADATA = {
  'view-dashboard': {
    title: 'Dashboard Overview',
    subtitle: 'Real-time sales metrics aggregated from Gold Mart star schema views'
  },
  'view-explainer': {
    title: 'Project Explainer & Knowledge Base',
    subtitle: 'Understand the problem, the architecture, and how data flows in simple English'
  },
  'view-medallion': {
    title: 'Medallion Architecture & ETL Flow',
    subtitle: 'Bronze raw ingestion ➔ Silver cleaning & SCD2 ➔ Gold star schema views'
  },
  'view-catalog': {
    title: 'Data Catalog & Schema Dictionary',
    subtitle: 'Column metadata, surrogate key definitions, and verified sample records'
  },
  'view-diagrams': {
    title: 'Architecture Blueprints & System Flowcharts',
    subtitle: 'High-resolution system diagrams (100% sanitized, zero external logos)'
  },
  'view-sql': {
    title: 'T-SQL Analytics Lab & FastAPI Gateway',
    subtitle: 'Interactive analytical queries against Gold schema and REST API tester'
  },
  'view-etl': {
    title: 'Automated Python ETL Pipeline Orchestrator',
    subtitle: 'Simulate pipeline/run_pipeline.py with data quality assertions & logging'
  }
};

// ---------------------------------------------------------------------------
// DOM Ready Initialization
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initApiStatus();
  renderDashboard();
  renderDataCatalog('gold.dim_customers');
  renderJourneyStep(1);
  renderDiffView('customers');
  initSqlSandbox();
  setupKeyboardShortcuts();
});

// ---------------------------------------------------------------------------
// 1. Navigation Controller
// ---------------------------------------------------------------------------
function navigateTo(viewId) {
  APP_STATE.currentView = viewId;

  // Update sidebar buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === `btn-nav-${viewId.replace('view-', '')}`);
  });

  // Switch visible view container
  document.querySelectorAll('.content-view').forEach(view => {
    view.classList.toggle('active', view.id === viewId);
  });

  // Update top header title & subtitle
  const meta = VIEW_METADATA[viewId] || { title: 'Enterprise Warehouse', subtitle: '' };
  document.getElementById('current-page-title').textContent = meta.title;
  document.getElementById('current-page-subtitle').textContent = meta.subtitle;

  // Redraw SVG chart if navigating to dashboard
  if (viewId === 'view-dashboard') {
    setTimeout(renderMonthlySvgChart, 50);
  }
}

// ---------------------------------------------------------------------------
// 2. Gateway Status Check
// ---------------------------------------------------------------------------
async function initApiStatus() {
  await checkApiGateway();
}

async function checkApiGateway() {
  const dot = document.getElementById('sidebar-status-dot');
  const text = document.getElementById('sidebar-status-text');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${APP_STATE.apiBaseUrl}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      APP_STATE.isApiLive = true;
      dot.className = 'status-indicator-dot';
      text.textContent = 'FastAPI Gateway Live (Port 8000)';
      return;
    }
  } catch (err) {
    // Expected when running statically
  }

  APP_STATE.isApiLive = false;
  dot.style.background = '#fbbf24';
  text.textContent = 'Local Standalone Mode · Active';
}

// ---------------------------------------------------------------------------
// 3. Dashboard Overview Renderer
// ---------------------------------------------------------------------------
function renderDashboard() {
  const data = window.WAREHOUSE_DATA;
  if (!data) return;

  // Top KPI widgets
  document.getElementById('val-revenue').textContent = formatCurrency(data.kpis.total_revenue);
  document.getElementById('val-orders').textContent = data.kpis.total_orders.toLocaleString();
  document.getElementById('val-aov').textContent = formatCurrency(data.kpis.avg_order_value);
  document.getElementById('val-customers').textContent = data.kpis.total_customers.toLocaleString();

  // Charts & Tables
  renderMonthlySvgChart();
  renderCategoryList();
  renderRegionalTable();
  renderTopProductsTable(data.top_products);
}

function applyAnalyticsFilters() {
  const country = document.getElementById('filter-country').value;
  const category = document.getElementById('filter-category').value;
  APP_STATE.filteredCountry = country;
  APP_STATE.filteredCategory = category;

  let revenue = window.WAREHOUSE_DATA.kpis.total_revenue;
  let orders = window.WAREHOUSE_DATA.kpis.total_orders;

  if (country !== 'ALL') {
    const cObj = window.WAREHOUSE_DATA.country.find(c => c.cntry === country);
    if (cObj) {
      revenue = cObj.sales;
      orders = cObj.orders;
    }
  }

  if (category !== 'ALL') {
    const catObj = window.WAREHOUSE_DATA.category.find(c => c.cat === category);
    if (catObj) {
      revenue = (revenue / window.WAREHOUSE_DATA.kpis.total_revenue) * catObj.sales;
      orders = Math.round((orders / window.WAREHOUSE_DATA.kpis.total_orders) * catObj.orders);
    }
  }

  document.getElementById('val-revenue').textContent = formatCurrency(revenue);
  document.getElementById('val-orders').textContent = orders.toLocaleString();
  document.getElementById('val-aov').textContent = formatCurrency(revenue / (orders || 1));

  renderMonthlySvgChart(country, category);
  renderCategoryList(country);
}

function refreshAnalyticsData() {
  const btn = document.getElementById('btn-refresh-data');
  btn.style.opacity = '0.5';
  btn.textContent = '🔄 Loading...';

  setTimeout(() => {
    btn.style.opacity = '1';
    btn.textContent = '🔄 Refresh';
    applyAnalyticsFilters();
  }, 350);
}

// ---------------------------------------------------------------------------
// 4. Interactive SVG Monthly Revenue Chart
// ---------------------------------------------------------------------------
function renderMonthlySvgChart(countryFilter = 'ALL', catFilter = 'ALL') {
  const svg = document.getElementById('monthly-svg-chart');
  const tooltip = document.getElementById('chart-tooltip');
  if (!svg || !window.WAREHOUSE_DATA) return;

  const rawMonthly = window.WAREHOUSE_DATA.monthly;
  if (!rawMonthly || rawMonthly.length === 0) return;

  let multiplier = 1.0;
  if (countryFilter !== 'ALL') {
    const cObj = window.WAREHOUSE_DATA.country.find(c => c.cntry === countryFilter);
    if (cObj) multiplier *= (cObj.sales / window.WAREHOUSE_DATA.kpis.total_revenue);
  }
  if (catFilter !== 'ALL') {
    const catObj = window.WAREHOUSE_DATA.category.find(c => c.cat === catFilter);
    if (catObj) multiplier *= (catObj.sales / window.WAREHOUSE_DATA.kpis.total_revenue);
  }

  const dataPoints = rawMonthly.map(m => ({
    date: m.year_month,
    sales: m.sales * multiplier,
    orders: Math.round(m.orders * multiplier)
  }));

  const maxSales = Math.max(...dataPoints.map(d => d.sales)) * 1.08;
  const width = 760;
  const height = 250;
  const padLeft = 60;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 30;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const getX = i => padLeft + (i / (dataPoints.length - 1)) * plotW;
  const getY = val => padTop + plotH - (val / maxSales) * plotH;

  let svgHtml = `
    <defs>
      <linearGradient id="chartAreaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#059669" stop-opacity="0.25" />
        <stop offset="65%" stop-color="#10b981" stop-opacity="0.06" />
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="chartLineGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#059669" />
        <stop offset="50%" stop-color="#047857" />
        <stop offset="100%" stop-color="#10b981" />
      </linearGradient>
    </defs>
  `;

  // Grid lines
  for (let i = 0; i <= 4; i++) {
    const val = (maxSales / 4) * i;
    const y = getY(val);
    svgHtml += `
      <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="rgba(16,185,129,0.14)" stroke-dasharray="3,3" />
      <text x="${padLeft - 8}" y="${y + 4}" fill="#527561" font-size="10" font-family="'JetBrains Mono'" text-anchor="end">${formatCompact(val)}</text>
    `;
  }

  let areaD = `M ${getX(0)} ${getY(dataPoints[0].sales)}`;
  let lineD = `M ${getX(0)} ${getY(dataPoints[0].sales)}`;

  for (let i = 1; i < dataPoints.length; i++) {
    const x = getX(i);
    const y = getY(dataPoints[i].sales);
    areaD += ` L ${x} ${y}`;
    lineD += ` L ${x} ${y}`;
  }

  areaD += ` L ${getX(dataPoints.length - 1)} ${padTop + plotH} L ${getX(0)} ${padTop + plotH} Z`;

  svgHtml += `<path d="${areaD}" fill="url(#chartAreaGrad)" />`;
  svgHtml += `<path d="${lineD}" fill="none" stroke="url(#chartLineGrad)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" />`;

  // X Labels
  dataPoints.forEach((d, i) => {
    if (i % 6 === 0 || i === dataPoints.length - 1) {
      svgHtml += `
        <text x="${getX(i)}" y="${height - 8}" fill="#527561" font-size="10" font-family="'JetBrains Mono'" text-anchor="middle">${d.date}</text>
      `;
    }
  });

  // Points
  dataPoints.forEach((d, i) => {
    svgHtml += `
      <circle class="svg-hover-point" data-idx="${i}" cx="${getX(i)}" cy="${getY(d.sales)}" r="3.5" fill="#ffffff" stroke="#059669" stroke-width="2" style="cursor: pointer;" />
    `;
  });

  svg.innerHTML = svgHtml;

  // Tooltip hover
  svg.querySelectorAll('.svg-hover-point').forEach(pt => {
    pt.addEventListener('mouseenter', () => {
      pt.setAttribute('r', '6');
      pt.setAttribute('stroke', '#fbbf24');
      const idx = parseInt(pt.getAttribute('data-idx'));
      const d = dataPoints[idx];

      const rect = svg.getBoundingClientRect();
      const cx = parseFloat(pt.getAttribute('cx'));
      const cy = parseFloat(pt.getAttribute('cy'));
      const px = (cx / width) * rect.width;
      const py = (cy / height) * rect.height;

      tooltip.innerHTML = `
        <strong style="color: #fbbf24;">${d.date}</strong><br>
        Revenue: <span style="color: #fff; font-family: 'JetBrains Mono';">${formatCurrency(d.sales)}</span><br>
        Orders: <span style="color: #38bdf8; font-family: 'JetBrains Mono';">${d.orders.toLocaleString()}</span>
      `;
      tooltip.style.left = `${px}px`;
      tooltip.style.top = `${py}px`;
      tooltip.classList.add('visible');
    });

    pt.addEventListener('mouseleave', () => {
      pt.setAttribute('r', '3.5');
      pt.setAttribute('stroke', '#38bdf8');
      tooltip.classList.remove('visible');
    });
  });
}

// ---------------------------------------------------------------------------
// 5. Category Metric Share
// ---------------------------------------------------------------------------
function renderCategoryList() {
  const container = document.getElementById('category-metric-list');
  if (!container || !window.WAREHOUSE_DATA) return;

  const categories = window.WAREHOUSE_DATA.category;
  const totalSales = categories.reduce((sum, c) => sum + c.sales, 0);

  const colors = {
    'Bikes': '#10b981',
    'Components': '#34d399',
    'Clothing': '#6ee7b7',
    'Accessories': '#fbbf24'
  };

  container.innerHTML = categories.map(cat => {
    const pct = ((cat.sales / totalSales) * 100).toFixed(1);
    const color = colors[cat.cat] || '#10b981';

    return `
      <div class="category-row">
        <div class="cat-header">
          <span class="cat-name">
            <span class="cat-dot" style="background: ${color}; box-shadow: 0 0 6px ${color};"></span>
            ${cat.cat}
          </span>
          <span class="cat-val">${formatCurrency(cat.sales)} (${pct}%)</span>
        </div>
        <div class="cat-progress-track">
          <div class="cat-progress-fill" style="width: ${pct}%; background: ${color};"></div>
        </div>
      </div>
    `;
  }).join('');
}

// ---------------------------------------------------------------------------
// 6. Regional Market Performance (Inspired by Image 3 Regional Table)
// ---------------------------------------------------------------------------
function renderRegionalTable() {
  const tbody = document.getElementById('tbody-regional-sales');
  if (!tbody || !window.WAREHOUSE_DATA) return;

  const countries = window.WAREHOUSE_DATA.country;
  const totalSales = window.WAREHOUSE_DATA.kpis.total_revenue;

  const flags = {
    'United States': '🇺🇸',
    'Australia': '🇦🇺',
    'United Kingdom': '🇬🇧',
    'Germany': '🇩🇪',
    'France': '🇫🇷',
    'Canada': '🇨🇦'
  };

  tbody.innerHTML = countries.map(c => {
    const flag = flags[c.cntry] || '🌐';
    const pct = ((c.sales / totalSales) * 100).toFixed(1);

    return `
      <tr>
        <td>
          <span class="flag-icon">${flag}</span>
          <strong style="color: #fff;">${c.cntry}</strong>
        </td>
        <td>${c.customers.toLocaleString()}</td>
        <td>${c.orders.toLocaleString()}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 50px; height: 5px; background: rgba(52,211,153,0.1); border-radius: 4px; overflow: hidden;">
              <div style="width: ${pct}%; height: 100%; background: #10b981;"></div>
            </div>
            <span style="font-size: 0.75rem; color: #a7f3d0;">${pct}%</span>
          </div>
        </td>
        <td><strong style="color: #34d399; font-family: var(--font-mono);">${formatCurrency(c.sales)}</strong></td>
      </tr>
    `;
  }).join('');
}

function renderTopProductsTable(products) {
  const tbody = document.getElementById('tbody-top-products');
  if (!tbody || !products) return;

  tbody.innerHTML = products.map((p, i) => `
    <tr>
      <td><span style="font-weight: 700; color: ${i < 3 ? '#fbbf24' : '#94a3b8'};">#${i + 1}</span></td>
      <td>
        <div style="font-weight: 600; color: #fff;">${p.prd_nm}</div>
        <div style="font-size: 0.72rem; color: #64748b; font-family: var(--font-mono);">${p.prd_clean_key}</div>
      </td>
      <td><span class="nav-badge-pill">${p.cat}</span></td>
      <td>${p.volume.toLocaleString()}</td>
      <td><strong style="color: #38bdf8; font-family: var(--font-mono);">${formatCurrency(p.total_revenue)}</strong></td>
    </tr>
  `).join('');
}

// ---------------------------------------------------------------------------
// 7. Interactive Project Explainer (Data Journey Stepper)
// ---------------------------------------------------------------------------
const JOURNEY_STEPS = {
  1: {
    title: "Step 1: The Raw Source Files (Disparate Silos)",
    desc: "Before our Data Warehouse, sales and customer data lived in separate CRM and ERP databases with dirty values, duplicate records, and conflicting keys.",
    box1Title: "CRM System (cust_info.csv)",
    box1Code: `cst_id: 11000
cst_key: "AW00011000"
cst_firstname: "  Jon  " (untrimmed whitespace)
cst_marital_status: "M"
cst_gndr: "M"
cst_create_date: "2013-02-05"

-- Duplicate row exists from earlier registration:
cst_id: 11000 | cst_create_date: "2011-01-10"`,
    box2Title: "ERP System (LOC_A101.csv & CUST_AZ12.csv)",
    box2Code: `cid: "NASAW-00011000" (Has legacy 'NAS' prefix!)
cntry: "USA" (Other records say 'US' or 'United States'!)
birthdate: "1971-10-06"

Problem:
How do you join CRM with ERP when the keys have different formats?
And which record is the real customer?`
  },
  2: {
    title: "Step 2: Bronze Ingestion (Raw Landing Tier)",
    desc: "Our automated ETL pipeline executes T-SQL BULK INSERT with TABLOCK optimization. It dumps the raw CSV data into Bronze tables without altering anything, creating an immutable audit trail.",
    box1Title: "T-SQL Execution (bronze.load_bronze)",
    box1Code: `TRUNCATE TABLE bronze.crm_cust_info;
BULK INSERT bronze.crm_cust_info
FROM 'datasets/source_crm/cust_info.csv'
WITH (FIRSTROW = 2, FIELDTERMINATOR = ',', TABLOCK);

-- Result:
60,398 sales lines & 18,494 customers ingested in 3.4 seconds.`,
    box2Title: "Bronze Guarantees",
    box2Code: `✓ 100% Raw Lineage: Exact ground truth from source.
✓ Zero Mutation: No type errors or dropped rows.
✓ Traceability: If an error happens later, we can always compare back to Bronze.`
  },
  3: {
    title: "Step 3: Silver Conformance (Deduplication & Cleaning)",
    desc: "The stored procedure silver.load_silver transforms raw data: eliminates duplicates, strips prefixes, standardizes codes, and tracks historical changes.",
    box1Title: "1. Deduplication with ROW_NUMBER()",
    box1Code: `SELECT * FROM (
    SELECT *, ROW_NUMBER() OVER (
        PARTITION BY cst_id ORDER BY cst_create_date DESC
    ) AS flag_last
    FROM bronze.crm_cust_info
) t WHERE flag_last = 1;
-- Keeps only the freshest customer profile!`,
    box2Title: "2. Key Normalization & Code Standardization",
    box2Code: `-- Strip legacy 'NAS' prefix to match CRM keys:
REPLACE(cid, 'NAS', '') AS cid

-- Standardize country domain:
CASE 
    WHEN TRIM(cntry) IN ('US', 'USA') THEN 'United States'
    WHEN TRIM(cntry) = 'DE' THEN 'Germany'
    ELSE TRIM(cntry)
END AS country`
  },
  4: {
    title: "Step 4: Gold Star Schema (Business-Ready Analytics)",
    desc: "The Gold layer presents the unified data as an analytical Star Schema view. Dimensions and facts are pre-joined with surrogate keys so BI tools can query at lightning speed.",
    box1Title: "Dimensional Views (gold.dim_customers)",
    box1Code: `CREATE VIEW gold.dim_customers AS
SELECT 
    ROW_NUMBER() OVER (ORDER BY cst_id) AS customer_key, -- Surrogate Key
    ci.cst_id AS customer_id,
    ci.cst_firstname AS first_name,
    ci.cst_lastname AS last_name,
    la.cntry AS country,
    ca.bdate AS birthdate
FROM silver.crm_cust_info ci
LEFT JOIN silver.erp_loc_a101 la ON ci.cst_key = la.cid;`,
    box2Title: "Fact Transactions (gold.fact_sales)",
    box2Code: `CREATE VIEW gold.fact_sales AS
SELECT 
    sd.sls_ord_num AS order_number,
    pr.product_key,   -- Linked to dim_products!
    cu.customer_key,  -- Linked to dim_customers!
    sd.sls_sales AS sales_amount,
    sd.sls_quantity AS quantity
FROM silver.crm_sales_details sd
JOIN gold.dim_products pr ON ...
JOIN gold.dim_customers cu ON ...`
  }
};

function selectJourneyStep(stepNum) {
  APP_STATE.selectedJourneyStep = stepNum;

  document.querySelectorAll('.journey-step-btn').forEach((btn, idx) => {
    btn.classList.toggle('active', idx + 1 === stepNum);
  });

  renderJourneyStep(stepNum);
}

function renderJourneyStep(stepNum) {
  const step = JOURNEY_STEPS[stepNum];
  const container = document.getElementById('journey-detail-content');
  if (!container || !step) return;

  container.innerHTML = `
    <h3 style="font-size: 1.15rem; color: #fff; margin-bottom: 6px;">${step.title}</h3>
    <p style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 18px; line-height: 1.5;">${step.desc}</p>
    
    <div class="diff-grid-view">
      <div class="diff-box">
        <div class="diff-box-header" style="color: #38bdf8;">${step.box1Title}</div>
        <pre class="diff-code">${escapeHtml(step.box1Code)}</pre>
      </div>
      <div class="diff-box">
        <div class="diff-box-header" style="color: #34d399;">${step.box2Title}</div>
        <pre class="diff-code">${escapeHtml(step.box2Code)}</pre>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// 8. Medallion Cleansing Diff Switcher
// ---------------------------------------------------------------------------
const DIFF_DATA = {
  customers: {
    raw: `-- Raw Ingestion (bronze.crm_cust_info)
cst_id: 11000 | cst_key: AW00011000 | cst_firstname: ' Jon '
cst_marital_status: 'M' | cst_gndr: 'M'
cst_create_date: '2013-02-05'

-- Older duplicate row in source:
cst_id: 11000 | cst_create_date: '2011-01-10'`,
    cleaned: `-- Silver Conformed Record (silver.crm_cust_info)
SELECT 
    cst_id, cst_key,
    TRIM(cst_firstname) AS cst_firstname,
    CASE UPPER(TRIM(cst_marital_status))
        WHEN 'M' THEN 'Married' WHEN 'S' THEN 'Single' ELSE 'n/a'
    END AS cst_marital_status,
    CASE UPPER(TRIM(cst_gndr))
        WHEN 'F' THEN 'Female' WHEN 'M' THEN 'Male' ELSE 'n/a'
    END AS cst_gndr
FROM (
    SELECT *, ROW_NUMBER() OVER (
        PARTITION BY cst_id ORDER BY cst_create_date DESC
    ) AS flag_last
    FROM bronze.crm_cust_info
) t WHERE flag_last = 1;`
  },
  products: {
    raw: `-- Raw Product Catalog (bronze.crm_prd_info)
prd_id: 212
prd_key: 'AC-BR-100' (Composite string!)
prd_cost: NULL
prd_line: 'S'
prd_start_dt: '2011-07-01'
-- Notice: End Date does NOT exist in source!`,
    cleaned: `-- Silver SCD Type 2 Product Record
SELECT 
    prd_id,
    REPLACE(SUBSTRING(prd_key, 1, 5), '-', '_') AS cat_id,
    SUBSTRING(prd_key, 7, LEN(prd_key)) AS prd_key,
    ISNULL(prd_cost, 0) AS prd_cost,
    CASE UPPER(TRIM(prd_line))
        WHEN 'M' THEN 'Mountain' WHEN 'R' THEN 'Road'
        WHEN 'S' THEN 'Other Sales' WHEN 'T' THEN 'Touring'
    END AS prd_line,
    prd_start_dt,
    DATEADD(day, -1, LEAD(prd_start_dt) OVER (
        PARTITION BY prd_key ORDER BY prd_start_dt
    )) AS prd_end_dt
FROM bronze.crm_prd_info;`
  },
  locations: {
    raw: `-- Disparate ERP Locations (bronze.erp_LOC_A101)
cid: 'NASAW-00011000' (Legacy ERP prefix 'NAS')
cntry: 'USA'
cid: 'NASAW-00011001'
cntry: 'United States'
cid: 'NASAW-00011002'
cntry: 'DE'`,
    cleaned: `-- Cleaned Silver Locations
SELECT
    REPLACE(cid, 'NAS', '') AS cid,
    CASE 
        WHEN TRIM(cntry) = 'DE' THEN 'Germany'
        WHEN TRIM(cntry) IN ('US', 'USA') THEN 'United States'
        WHEN TRIM(cntry) = '' OR cntry IS NULL THEN 'n/a'
        ELSE TRIM(cntry)
    END AS cntry
FROM bronze.erp_LOC_A101;`
  }
};

function switchDiffView(type) {
  document.querySelectorAll('.btn-group-pill .pill-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === `btn-diff-${type}`);
  });
  renderDiffView(type);
}

function renderDiffView(type) {
  const item = DIFF_DATA[type];
  const container = document.getElementById('diff-content-grid');
  if (!container || !item) return;

  container.innerHTML = `
    <div class="diff-box">
      <div class="diff-box-header" style="color: #f87171;">🔴 Bronze Ingestion (Raw, Dirty Input)</div>
      <pre class="diff-code">${escapeHtml(item.raw)}</pre>
    </div>
    <div class="diff-box">
      <div class="diff-box-header" style="color: #34d399;">🟢 Silver Layer (T-SQL Cleansed Output)</div>
      <pre class="diff-code">${escapeHtml(item.cleaned)}</pre>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// 9. Data Catalog & Schema Dictionary
// ---------------------------------------------------------------------------
function selectCatalogTable(tableName) {
  APP_STATE.selectedCatalogTable = tableName;

  document.querySelectorAll('.cat-select-btn').forEach(btn => {
    btn.classList.toggle('active', btn.id === `btn-table-${tableName.split('.')[1].replace('dim_', '').replace('fact_', '')}`);
  });

  renderDataCatalog(tableName);
}

function renderDataCatalog(tableName) {
  const catalog = window.WAREHOUSE_CATALOG;
  const tableData = catalog ? catalog[tableName] : null;
  if (!tableData) return;

  document.getElementById('selected-table-name').textContent = tableName;
  document.getElementById('selected-table-purpose').textContent = tableData.purpose;

  const tbody = document.getElementById('tbody-dictionary-columns');
  tbody.innerHTML = tableData.columns.map(col => {
    let keyBadge = '';
    if (col.key.includes('PK') || col.key.includes('Surrogate')) {
      keyBadge = `<span class="nav-badge-pill" style="color: #fbbf24; background: rgba(251,191,36,0.15);">${col.key}</span>`;
    } else if (col.key.includes('FK')) {
      keyBadge = `<span class="nav-badge-pill" style="color: #a78bfa; background: rgba(167,139,250,0.15);">${col.key}</span>`;
    } else if (col.key) {
      keyBadge = `<span class="nav-badge-pill">${col.key}</span>`;
    }

    return `
      <tr>
        <td>
          <strong style="color: #fff; font-family: var(--font-mono);">${col.name}</strong>
          ${keyBadge}
        </td>
        <td><span class="nav-badge-pill" style="color: #38bdf8; background: rgba(56,189,248,0.12); font-family: var(--font-mono);">${col.type}</span></td>
        <td>${col.key || 'Attribute'}</td>
        <td style="color: #cbd5e1;">${col.desc}</td>
      </tr>
    `;
  }).join('');

  renderSampleRecords(tableName);
}

function renderSampleRecords(tableName, filterText = '') {
  const data = window.WAREHOUSE_DATA;
  if (!data) return;

  let records = [];
  let cols = [];

  if (tableName === 'gold.dim_customers') {
    records = data.sample_customers;
    cols = ['cst_id', 'cst_key', 'cst_firstname', 'cst_lastname', 'cntry', 'cst_marital_status', 'cst_gndr'];
  } else if (tableName === 'gold.dim_products') {
    records = data.sample_products;
    cols = ['prd_id', 'prd_clean_key', 'prd_nm', 'cat', 'subcat', 'maintenance', 'prd_cost'];
  } else {
    records = data.sample_sales;
    cols = ['sls_ord_num', 'sls_prd_key', 'sls_cust_id', 'sls_order_dt', 'sls_sales', 'sls_quantity', 'sls_price'];
  }

  if (filterText) {
    const q = filterText.toLowerCase();
    records = records.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));
  }

  const thead = document.getElementById('sample-table-thead');
  const tbody = document.getElementById('sample-table-tbody');

  thead.innerHTML = `<tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>`;
  tbody.innerHTML = records.map(r => `
    <tr>${cols.map(c => `<td>${r[c] !== undefined && r[c] !== null ? r[c] : '—'}</td>`).join('')}</tr>
  `).join('');
}

function filterCatalogContent(text) {
  renderSampleRecords(APP_STATE.selectedCatalogTable, text);
}

// ---------------------------------------------------------------------------
// 10. Blueprint Lightbox Modal
// ---------------------------------------------------------------------------
function openDiagramLightbox(src, title) {
  const modal = document.getElementById('diagram-lightbox-modal');
  const img = document.getElementById('lightbox-image');
  const titleEl = document.getElementById('lightbox-title');

  img.src = src;
  titleEl.textContent = title;
  modal.classList.add('active');
}

function closeDiagramLightbox(e) {
  const modal = document.getElementById('diagram-lightbox-modal');
  modal.classList.remove('active');
}

// ---------------------------------------------------------------------------
// 11. SQL Query Lab
// ---------------------------------------------------------------------------
function initSqlSandbox() {
  const select = document.getElementById('select-sql-query');
  if (!select || !window.WAREHOUSE_QUERIES) return;

  select.innerHTML = window.WAREHOUSE_QUERIES.map(q => `
    <option value="${q.id}">${q.title}</option>
  `).join('');

  loadSelectedSqlQuery();
}

function loadSelectedSqlQuery() {
  const select = document.getElementById('select-sql-query');
  const query = window.WAREHOUSE_QUERIES.find(q => q.id === select.value);
  if (!query) return;

  document.getElementById('sql-editor-display').textContent = query.sql;
  document.getElementById('sql-results-meta').textContent = 'Ready to execute against Gold Mart views';
  document.getElementById('sql-results-table-box').innerHTML = `
    <div style="color: #64748b; font-style: italic; padding: 20px;">Click "▶ Execute Query" to view compiled execution output...</div>
  `;
}

function executeSqlQuery() {
  const select = document.getElementById('select-sql-query');
  const query = window.WAREHOUSE_QUERIES.find(q => q.id === select.value);
  if (!query) return;

  const box = document.getElementById('sql-results-table-box');
  const meta = document.getElementById('sql-results-meta');
  box.innerHTML = `<div style="color: #38bdf8; padding: 20px;">⚡ Executing query against Microsoft SQL Server...</div>`;

  setTimeout(() => {
    meta.innerHTML = `<span style="color: #34d399; font-weight: 700;">✓ 200 OK</span> · Duration: <strong>11ms</strong> · Rows: <strong>${query.rows.length}</strong>`;
    box.innerHTML = `
      <table class="saas-table font-mono" style="font-size: 0.78rem;">
        <thead>
          <tr>${query.columns.map(c => `<th>${c}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${query.rows.map(r => `<tr>${r.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    `;
  }, 220);
}

async function sendApiRequest() {
  const select = document.getElementById('select-api-endpoint');
  const endpoint = select.value;
  const jsonPre = document.getElementById('api-json-pre');
  const timing = document.getElementById('api-timing-tag');

  timing.textContent = 'Pinging...';
  timing.style.color = '#38bdf8';
  jsonPre.textContent = `// GET ${endpoint}...`;

  const startTime = performance.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${APP_STATE.apiBaseUrl}${endpoint}`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const elapsed = (performance.now() - startTime).toFixed(1);
      timing.textContent = `HTTP 200 OK (${elapsed}ms)`;
      timing.style.color = '#34d399';
      jsonPre.textContent = JSON.stringify(data, null, 2);
      return;
    }
  } catch (err) {
    // fallback to realistic mock JSON
  }

  setTimeout(() => {
    let mock = {};
    if (endpoint.includes('/kpis')) mock = window.WAREHOUSE_DATA.kpis;
    else if (endpoint.includes('/sales-by-country')) mock = window.WAREHOUSE_DATA.country;
    else if (endpoint.includes('/sales-by-category')) mock = window.WAREHOUSE_DATA.category;
    else if (endpoint.includes('/monthly-sales')) mock = window.WAREHOUSE_DATA.monthly.slice(0, 10);
    else if (endpoint.includes('/top-customers')) mock = window.WAREHOUSE_DATA.top_customers.slice(0, 5);
    else if (endpoint.includes('/top-products')) mock = window.WAREHOUSE_DATA.top_products.slice(0, 5);
    else mock = { status: "ok", engine: "Microsoft SQL Server", connection_pool: "healthy" };

    timing.textContent = `HTTP 200 OK (Mock · 8.2ms)`;
    timing.style.color = '#34d399';
    jsonPre.textContent = JSON.stringify(mock, null, 2);
  }, 120);
}

// ---------------------------------------------------------------------------
// 12. Automated ETL Pipeline Simulation
// ---------------------------------------------------------------------------
function runPipelineSimulation() {
  const btn = document.getElementById('btn-trigger-etl');
  const consoleEl = document.getElementById('pipeline-terminal-console');
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.6';
  }

  const logs = [
    { text: '[PIPELINE INIT] Initializing pyodbc context manager to localhost\\SQLEXPRESS...', type: 'log-info', delay: 100 },
    { text: '[STAGE 1] Invoking bronze.load_bronze stored procedure...', type: 'log-info', delay: 400 },
    { text: '>> Ingesting bronze.crm_cust_info (18,494 rows via BULK INSERT TABLOCK)...', type: 'log-info', delay: 700 },
    { text: '>> Ingesting bronze.crm_prd_info (397 catalog rows)...', type: 'log-info', delay: 900 },
    { text: '>> Ingesting bronze.crm_sales_details (60,398 transaction line items)...', type: 'log-info', delay: 1200 },
    { text: '[STAGE 1 COMPLETE] Bronze raw landing tables populated in 3.42s.', type: 'log-success', delay: 1500 },
    { text: '[STAGE 2] Invoking silver.load_silver stored procedure...', type: 'log-info', delay: 1800 },
    { text: '>> Executing ROW_NUMBER() windowed partition deduplication on customer records...', type: 'log-info', delay: 2100 },
    { text: '>> Calculating LEAD(prd_start_dt) SCD Type 2 product validity end-dates...', type: 'log-info', delay: 2400 },
    { text: '>> Normalizing country domains (USA/US -> United States, DE -> Germany)...', type: 'log-info', delay: 2700 },
    { text: '[STAGE 2 COMPLETE] Silver conformed tables created in 4.10s.', type: 'log-success', delay: 3000 },
    { text: '[STAGE 3] Refreshing Gold Layer Star Schema Views...', type: 'log-info', delay: 3300 },
    { text: '[STAGE 4 QA] Executing automated data quality assertions...', type: 'log-warn', delay: 3600 },
    { text: '>> Assertion 1: gold.dim_customers PK uniqueness -> PASSED (0 duplicate keys)', type: 'log-success', delay: 3900 },
    { text: '>> Assertion 2: gold.dim_products PK uniqueness -> PASSED (0 duplicate keys)', type: 'log-success', delay: 4100 },
    { text: '>> Assertion 3: gold.fact_sales foreign key referential integrity -> PASSED (0 orphan keys)', type: 'log-success', delay: 4300 },
    { text: '>> Assertion 4: Fact table row count exact reconciliation -> PASSED (60,398 lines matched)', type: 'log-success', delay: 4500 },
    { text: '[PIPELINE FINISHED] Pipeline execution succeeded with exit code 0. Zero errors.', type: 'log-success', delay: 4800 }
  ];

  consoleEl.innerHTML = '';

  logs.forEach(item => {
    setTimeout(() => {
      const line = document.createElement('div');
      line.className = `log-line ${item.type}`;
      line.textContent = `[${new Date().toLocaleTimeString()}] ${item.text}`;
      consoleEl.appendChild(line);
      consoleEl.scrollTop = consoleEl.scrollHeight;

      if (item.delay === 4800 && btn) {
        btn.disabled = false;
        btn.style.opacity = '1';
      }
    }, item.delay);
  });
}

// ---------------------------------------------------------------------------
// 13. Global Search & Keyboard Shortcuts
// ---------------------------------------------------------------------------
function handleGlobalSearch(query) {
  const q = query.toLowerCase().trim();
  if (!q) return;

  if (q.includes('sql') || q.includes('query')) navigateTo('view-sql');
  else if (q.includes('etl') || q.includes('pipeline')) navigateTo('view-etl');
  else if (q.includes('schema') || q.includes('catalog') || q.includes('cust') || q.includes('prod') || q.includes('fact')) navigateTo('view-catalog');
  else if (q.includes('diagram') || q.includes('arch') || q.includes('flow')) navigateTo('view-diagrams');
  else if (q.includes('medallion') || q.includes('bronze') || q.includes('silver') || q.includes('gold')) navigateTo('view-medallion');
  else if (q.includes('explain') || q.includes('guide') || q.includes('how')) navigateTo('view-explainer');
  else navigateTo('view-dashboard');
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const input = document.getElementById('global-search-input');
      if (input) input.focus();
    } else if (e.key === 'Escape') {
      closeDiagramLightbox();
    }
  });
}

// ---------------------------------------------------------------------------
// 14. Helper Formatting
// ---------------------------------------------------------------------------
function formatCurrency(val) {
  if (val === null || val === undefined) return '$0';
  return '$' + Math.round(val).toLocaleString('en-US');
}

function formatCompact(val) {
  if (val >= 1000000) return '$' + (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return '$' + (val / 1000).toFixed(0) + 'K';
  return '$' + Math.round(val);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
