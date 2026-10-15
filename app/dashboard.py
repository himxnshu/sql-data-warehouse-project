"""
Enterprise Analytics Dashboard for SQL Server Medallion Data Warehouse.
Consumes FastAPI backend endpoints over Gold star schema views.
"""

import os
from datetime import date
from concurrent.futures import ThreadPoolExecutor
from typing import Any
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import requests
import streamlit as st

# --------------------------------------------------------------------------- #
# Page Setup & Styling
# --------------------------------------------------------------------------- #
st.set_page_config(
    page_title="Enterprise Sales Analytics",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom High-Contrast Brightness & Component CSS
st.markdown("""
<style>
    /* Metric Cards */
    .metric-container {
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 1px solid #334155;
        border-radius: 12px;
        padding: 18px 20px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
        transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .metric-container:hover {
        border-color: #38bdf8;
        transform: translateY(-2px);
    }
    .metric-label {
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #94a3b8;
        margin-bottom: 6px;
    }
    .metric-number {
        font-size: 1.8rem;
        font-weight: 700;
        color: #f8fafc;
        line-height: 1.1;
    }
    .metric-tag {
        font-size: 0.75rem;
        font-weight: 500;
        color: #38bdf8;
        margin-top: 6px;
    }

    /* Tabs Styling */
    .stTabs [data-baseweb="tab-list"] {
        gap: 10px;
        border-bottom: 1px solid #334155;
        padding-bottom: 6px;
    }
    .stTabs [data-baseweb="tab"] {
        border-radius: 8px;
        color: #94a3b8;
        font-weight: 600;
        padding: 8px 18px;
    }
    .stTabs [aria-selected="true"] {
        background-color: #1e293b !important;
        color: #38bdf8 !important;
        border: 1px solid #38bdf8;
    }

    /* Subtle Dividers */
    .section-divider {
        height: 1px;
        background: #334155;
        margin: 20px 0;
    }
</style>
""", unsafe_allow_html=True)

# --------------------------------------------------------------------------- #
# Sidebar & Configuration
# --------------------------------------------------------------------------- #
st.sidebar.markdown("### ⚙️ System Controls")
default_endpoint = os.getenv("API_URL", "http://127.0.0.1:8000")
API_URL = st.sidebar.text_input("FastAPI Gateway", default_endpoint).rstrip("/")

if st.sidebar.button("🔄 Refresh Data Cache", use_container_width=True):
    st.cache_data.clear()
    st.rerun()

st.sidebar.markdown("<div class='section-divider'></div>", unsafe_allow_html=True)
st.sidebar.markdown("### 🏗️ Data Architecture")
st.sidebar.caption("**Data Engine:** Microsoft SQL Server")
st.sidebar.caption("**Layer:** Gold Star Schema (`dim_*`, `fact_*`)")
st.sidebar.caption("**Transport:** FastAPI (REST API JSON)")

# --------------------------------------------------------------------------- #
# API Access Layer
# --------------------------------------------------------------------------- #
@st.cache_data(ttl=60, show_spinner=False)
def _fetch(api_url: str, path: str, params: tuple[tuple[str, Any], ...]) -> Any:
    response = requests.get(f"{api_url}{path}", params=dict(params), timeout=25)
    response.raise_for_status()
    return response.json()

def api_get(path: str, **params: Any) -> Any:
    """GET a path from the API. Params set to None are dropped."""
    clean = tuple(sorted((k, v) for k, v in params.items() if v is not None))
    return _fetch(API_URL, path, clean)
# --------------------------------------------------------------------------- #
# Dashboard Header
# --------------------------------------------------------------------------- #
st.title("📊 Enterprise Sales Data Warehouse")
st.markdown("<span style='color: #94a3b8; font-size: 0.95rem;'>Operational BI Engine · Gold Mart Star Schema</span>", unsafe_allow_html=True)
st.markdown("<div class='section-divider'></div>", unsafe_allow_html=True)

# --------------------------------------------------------------------------- #
# Concurrent Data Ingestion for Initial Load
# --------------------------------------------------------------------------- #
try:
    with ThreadPoolExecutor(max_workers=6) as executor:
        fut_kpis = executor.submit(api_get, "/kpis")
        fut_monthly = executor.submit(api_get, "/analytics/monthly-sales")
        fut_country = executor.submit(api_get, "/analytics/sales-by-country")
        fut_category = executor.submit(api_get, "/analytics/sales-by-category")
        fut_top_cust = executor.submit(api_get, "/analytics/top-customers", limit=10)
        fut_top_prod = executor.submit(api_get, "/analytics/top-products", limit=10)

    kpis = fut_kpis.result()
    monthly = pd.DataFrame(fut_monthly.result())
    by_country = pd.DataFrame(fut_country.result())
    by_category = pd.DataFrame(fut_category.result())
    top_customers = pd.DataFrame(fut_top_cust.result())
    top_products = pd.DataFrame(fut_top_prod.result())

except requests.RequestException as exc:
    st.error(f"Could not reach the API at {API_URL}: {exc}")
    st.info("Ensure the FastAPI service is running: `uvicorn api.main:app`")
    st.stop()

# --------------------------------------------------------------------------- #
# Navigation Tabs
# --------------------------------------------------------------------------- #
tab_overview, tab_customers, tab_products, tab_sales = st.tabs(
    ["📈 Overview", "👥 Customers", "📦 Products", "💳 Sales Transactions"]
)

# --------------------------------------------------------------------------- #
# 1. Overview Tab
# --------------------------------------------------------------------------- #
with tab_overview:
    # High-contrast metric cards
    c1, c2, c3, c4, c5 = st.columns(5)

    with c1:
        st.markdown(f"""
        <div class="metric-container">
            <div class="metric-label">Total Revenue</div>
            <div class="metric-number">\${kpis.get('total_sales', 0):,.0f}</div>
            <div class="metric-tag">Gross Sales</div>
        </div>
        """, unsafe_allow_html=True)

    with c2:
        st.markdown(f"""
        <div class="metric-container">
            <div class="metric-label">Total Orders</div>
            <div class="metric-number">{kpis.get('total_orders', 0):,}</div>
            <div class="metric-tag">Completed Invoices</div>
        </div>
        """, unsafe_allow_html=True)

    with c3:
        st.markdown(f"""
        <div class="metric-container">
            <div class="metric-label">Units Sold</div>
            <div class="metric-number">{kpis.get('total_quantity', 0):,}</div>
            <div class="metric-tag">Total Quantity</div>
        </div>
        """, unsafe_allow_html=True)

    with c4:
        st.markdown(f"""
        <div class="metric-container">
            <div class="metric-label">Active Customers</div>
            <div class="metric-number">{kpis.get('active_customers', 0):,}</div>
            <div class="metric-tag">Unique Accounts</div>
        </div>
        """, unsafe_allow_html=True)

    with c5:
        st.markdown(f"""
        <div class="metric-container">
            <div class="metric-label">Avg Order Value</div>
            <div class="metric-number">\${kpis.get('avg_order_value', 0):,.2f}</div>
            <div class="metric-tag">Per Transaction</div>
        </div>
        """, unsafe_allow_html=True)

    st.markdown("<div class='section-divider'></div>", unsafe_allow_html=True)

    # Monthly Sales Chart
    if monthly.empty:
        st.info("No dated sales found.")
    else:
        monthly["sales_month"] = pd.to_datetime(monthly["sales_month"])
        fig_monthly = px.area(
            monthly,
            x="sales_month",
            y="total_sales",
            title="Monthly Sales Trajectory",
            labels={"sales_month": "Month", "total_sales": "Sales (\$)"},
            color_discrete_sequence=["#38bdf8"]
        )
        fig_monthly.update_layout(
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
            margin=dict(l=10, r=10, t=40, b=10),
            font=dict(color="#94a3b8"),
            xaxis=dict(showgrid=True, gridcolor="#334155"),
            yaxis=dict(showgrid=True, gridcolor="#334155")
        )
        st.plotly_chart(fig_monthly, use_container_width=True)

    # Secondary Visuals Row
    col_geo, col_cat = st.columns(2)
    with col_geo:
        if not by_country.empty:
            fig_country = px.bar(
                by_country,
                x="country",
                y="total_sales",
                title="Sales by Country",
                labels={"country": "Country", "total_sales": "Sales (\$)"},
                color="total_sales",
                color_continuous_scale="Blues"
            )
            fig_country.update_layout(
                paper_bgcolor="rgba(0,0,0,0)",
                plot_bgcolor="rgba(0,0,0,0)",
                margin=dict(l=10, r=10, t=40, b=10),
                font=dict(color="#94a3b8"),
                xaxis=dict(gridcolor="#334155"),
                yaxis=dict(gridcolor="#334155"),
                coloraxis_showscale=False
            )
            st.plotly_chart(fig_country, use_container_width=True)

    with col_cat:
        if not by_category.empty:
            fig_cat = px.bar(
                by_category.sort_values("total_sales"),
                x="total_sales",
                y="category",
                orientation="h",
                title="Sales by Category",
                labels={"category": "Category", "total_sales": "Sales (\$)"},
                color_discrete_sequence=["#818cf8"]
            )
            fig_cat.update_layout(
                paper_bgcolor="rgba(0,0,0,0)",
                plot_bgcolor="rgba(0,0,0,0)",
                margin=dict(l=10, r=10, t=40, b=10),
                font=dict(color="#94a3b8"),
                xaxis=dict(gridcolor="#334155"),
                yaxis=dict(gridcolor="#334155")
            )
            st.plotly_chart(fig_cat, use_container_width=True)

    # Top Entities Tables Row
    col_t1, col_t2 = st.columns(2)
    with col_t1:
        st.subheader("Top 10 Customers")
        st.dataframe(top_customers, hide_index=True, use_container_width=True)
    with col_t2:
        st.subheader("Top 10 Products")
        st.dataframe(top_products, hide_index=True, use_container_width=True)

# --------------------------------------------------------------------------- #
# 2. Customers Tab
# --------------------------------------------------------------------------- #
with tab_customers:
    countries = sorted(by_country["country"].unique()) if not by_country.empty else []
    col_a, col_b = st.columns(2)
    country = col_a.selectbox("Country", ["All"] + countries, key="customer_country")
    rows = col_b.selectbox("Rows to load", [100, 500, 1000], key="customer_rows")

    customers = pd.DataFrame(
        api_get("/customers", country=None if country == "All" else country, limit=rows)
    )
    st.write(f"Showing **{len(customers):,}** customers")
    st.dataframe(customers, hide_index=True, use_container_width=True)
    if not customers.empty:
        st.download_button(
            "📥 Download Customers CSV",
            customers.to_csv(index=False),
            "customers.csv",
            "text/csv"
        )

# --------------------------------------------------------------------------- #
# 3. Products Tab
# --------------------------------------------------------------------------- #
with tab_products:
    categories = sorted(by_category["category"].unique()) if not by_category.empty else []
    col_a, col_b = st.columns(2)
    category = col_a.selectbox("Category", ["All"] + categories, key="product_category")
    rows = col_b.selectbox("Rows to load", [100, 500, 1000], key="product_rows")

    products = pd.DataFrame(
        api_get("/products", category=None if category == "All" else category, limit=rows)
    )
    st.write(f"Showing **{len(products):,}** products")
    st.dataframe(products, hide_index=True, use_container_width=True)
    if not products.empty:
        st.download_button(
            "📥 Download Products CSV",
            products.to_csv(index=False),
            "products.csv",
            "text/csv"
        )

# --------------------------------------------------------------------------- #
# 4. Sales Tab
# --------------------------------------------------------------------------- #
with tab_sales:
    if monthly.empty:
        default_range = (date(2010, 1, 1), date.today())
    else:
        first = monthly["sales_month"].min().date()
        last = (monthly["sales_month"].max() + pd.offsets.MonthEnd(0)).date()
        default_range = (first, last)

    col_a, col_b = st.columns(2)
    chosen = col_a.date_input("Order date range", value=default_range, key="sales_range")
    rows = col_b.selectbox("Rows to load", [100, 500, 1000], key="sales_rows")

    if isinstance(chosen, tuple) and len(chosen) == 2:
        sales = pd.DataFrame(
            api_get("/sales", start_date=chosen[0], end_date=chosen[1], limit=rows)
        )
        st.write(f"Showing **{len(sales):,}** sales records")
        st.dataframe(sales, hide_index=True, use_container_width=True)
        if not sales.empty:
            st.download_button(
                "📥 Download Sales CSV",
                sales.to_csv(index=False),
                "sales.csv",
                "text/csv"
            )
    else:
        st.info("Pick both a start and an end date.")