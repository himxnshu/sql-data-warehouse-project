"""
FastAPI backend that exposes the Gold layer (star schema views) as a REST API.

Run from the project root:
    uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload

Interactive docs (Swagger UI): http://localhost:8000/docs
"""

import logging
import sys
from datetime import date
from pathlib import Path
from typing import Optional

try:
    import pyodbc
except Exception:
    pyodbc = None

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # lets `import db` work from anywhere

try:
    import db  # noqa: E402  (shared connection helper, reads .env)
except Exception:
    db = None

log = logging.getLogger("uvicorn.error")

app = FastAPI(
    title="Data Warehouse API",
    version="1.0.0",
    description="Read-only API over the Gold layer: gold.dim_customers, gold.dim_products, gold.fact_sales.",
)

# --------------------------------------------------------------------------- #
# Static Site & Portal Mounting
# --------------------------------------------------------------------------- #
SITE_DIR = Path(__file__).resolve().parent.parent / "site"
if SITE_DIR.exists():
    if (SITE_DIR / "css").exists():
        app.mount("/css", StaticFiles(directory=str(SITE_DIR / "css")), name="css")
    if (SITE_DIR / "js").exists():
        app.mount("/js", StaticFiles(directory=str(SITE_DIR / "js")), name="js")
    if (SITE_DIR / "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(SITE_DIR / "assets")), name="assets")
    app.mount("/site", StaticFiles(directory=str(SITE_DIR), html=True), name="site")


# --------------------------------------------------------------------------- #
# Database helpers (Non-blocking thread pool execution)
# --------------------------------------------------------------------------- #
def _exec_db_query(sql: str, params: Optional[list] = None) -> list[dict]:
    """Synchronous database worker invoked within a thread pool worker."""
    if db is None:
        raise HTTPException(status_code=503, detail="Database module not available (ODBC missing or offline)")
    try:
        return db.query(sql, params or [])
    except Exception:
        log.exception("Database error occurred while executing query.")
        raise HTTPException(status_code=503, detail="Database unavailable or query failed")


async def run_query(sql: str, params: Optional[list] = None) -> list[dict]:
    """Asynchronous wrapper that runs blocking pyodbc calls on a separate worker thread.
    
    This prevents parallel Streamlit queries from freezing FastAPI's asyncio loop.
    """
    return await run_in_threadpool(_exec_db_query, sql, params)


# --------------------------------------------------------------------------- #
# Root & Health Checks
# --------------------------------------------------------------------------- #
@app.get("/", include_in_schema=False)
async def root():
    """Serves the interactive custom Enterprise Data Warehouse portal directly at root."""
    index_file = SITE_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {
        "status": "healthy",
        "service": "Data Warehouse Gold Mart API",
        "docs": "/docs",
    }


@app.get("/portal", include_in_schema=False)
async def portal():
    """Serves the interactive custom Enterprise Data Warehouse portal."""
    index_file = SITE_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    raise HTTPException(status_code=404, detail="Portal index.html not found")


@app.get("/health", tags=["system"])
async def health() -> dict:
    """Check that the API can reach the database."""
    await run_query("SELECT 1 AS ok")
    return {"status": "ok"}


# --------------------------------------------------------------------------- #
# Customers
# --------------------------------------------------------------------------- #
CUSTOMER_COLUMNS = """
    customer_key, customer_id, customer_number, first_name, last_name,
    country, marital_status, gender, birthdate, create_date
"""


@app.get("/customers", tags=["customers"])
async def list_customers(
    country: Optional[str] = Query(None, description="Filter by exact country name"),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> list[dict]:
    """List customers (paginated), optionally filtered by country."""
    sql = f"SELECT {CUSTOMER_COLUMNS} FROM gold.dim_customers"
    params: list = []
    if country:
        sql += " WHERE country = ?"
        params.append(country)
    sql += " ORDER BY customer_key OFFSET ? ROWS FETCH NEXT ? ROWS ONLY"
    params += [offset, limit]
    return await run_query(sql, params)


@app.get("/customers/{customer_id}", tags=["customers"])
async def get_customer(customer_id: int) -> dict:
    """One customer plus their order count and total sales."""
    rows = await run_query(
        f"SELECT {CUSTOMER_COLUMNS} FROM gold.dim_customers WHERE customer_id = ?",
        [customer_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"Customer {customer_id} not found")

    summary = (
        await run_query(
            """
            SELECT COUNT(DISTINCT f.order_number)  AS orders,
                   COALESCE(SUM(f.sales_amount), 0) AS total_sales
            FROM gold.fact_sales f
            JOIN gold.dim_customers c ON c.customer_key = f.customer_key
            WHERE c.customer_id = ?
            """,
            [customer_id],
        )
    )[0]
    return {**rows[0], **summary}


# --------------------------------------------------------------------------- #
# Products
# --------------------------------------------------------------------------- #
@app.get("/products", tags=["products"])
async def list_products(
    category: Optional[str] = Query(None, description="Filter by exact category name"),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> list[dict]:
    """List current products (paginated), optionally filtered by category."""
    sql = """
        SELECT product_key, product_id, product_number, product_name, category,
               subcategory, maintenance, cost, product_line, start_date
        FROM gold.dim_products
    """
    params: list = []
    if category:
        sql += " WHERE category = ?"
        params.append(category)
    sql += " ORDER BY product_key OFFSET ? ROWS FETCH NEXT ? ROWS ONLY"
    params += [offset, limit]
    return await run_query(sql, params)


# --------------------------------------------------------------------------- #
# Sales
# --------------------------------------------------------------------------- #
@app.get("/sales", tags=["sales"])
async def list_sales(
    start_date: Optional[date] = Query(None, description="Order date >= (YYYY-MM-DD)"),
    end_date: Optional[date] = Query(None, description="Order date <= (YYYY-MM-DD)"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> list[dict]:
    """Sales lines joined with customer and product details, newest first."""
    sql = """
        SELECT f.order_number, f.order_date, f.shipping_date, f.due_date,
               c.first_name + ' ' + c.last_name AS customer_name,
               c.country, p.product_name, p.category,
               f.quantity, f.price, f.sales_amount
        FROM gold.fact_sales f
        LEFT JOIN gold.dim_customers c ON c.customer_key = f.customer_key
        LEFT JOIN gold.dim_products  p ON p.product_key  = f.product_key
        WHERE 1 = 1
    """
    params: list = []
    if start_date:
        sql += " AND f.order_date >= ?"
        params.append(start_date)
    if end_date:
        sql += " AND f.order_date <= ?"
        params.append(end_date)
    sql += " ORDER BY f.order_date DESC, f.order_number OFFSET ? ROWS FETCH NEXT ? ROWS ONLY"
    params += [offset, limit]
    return await run_query(sql, params)


# --------------------------------------------------------------------------- #
# KPIs and analytics
# --------------------------------------------------------------------------- #
@app.get("/kpis", tags=["analytics"])
async def kpis() -> dict:
    """Headline numbers for the dashboard."""
    rows = await run_query(
        """
        SELECT COALESCE(SUM(sales_amount), 0)   AS total_sales,
               COUNT(DISTINCT order_number)     AS total_orders,
               COALESCE(SUM(quantity), 0)       AS total_quantity,
               COUNT(DISTINCT customer_key)     AS active_customers
        FROM gold.fact_sales
        """
    )
    row = rows[0]
    orders = row["total_orders"]
    row["avg_order_value"] = round(row["total_sales"] / orders, 2) if orders else 0
    return row


@app.get("/analytics/sales-by-country", tags=["analytics"])
async def sales_by_country() -> list[dict]:
    return await run_query(
        """
        SELECT COALESCE(c.country, 'n/a')        AS country,
               SUM(f.sales_amount)               AS total_sales,
               COUNT(DISTINCT f.order_number)    AS orders
        FROM gold.fact_sales f
        LEFT JOIN gold.dim_customers c ON c.customer_key = f.customer_key
        GROUP BY COALESCE(c.country, 'n/a')
        ORDER BY total_sales DESC
        """
    )


@app.get("/analytics/sales-by-category", tags=["analytics"])
async def sales_by_category() -> list[dict]:
    return await run_query(
        """
        SELECT COALESCE(p.category, 'n/a')       AS category,
               SUM(f.sales_amount)               AS total_sales,
               SUM(f.quantity)                   AS quantity
        FROM gold.fact_sales f
        LEFT JOIN gold.dim_products p ON p.product_key = f.product_key
        GROUP BY COALESCE(p.category, 'n/a')
        ORDER BY total_sales DESC
        """
    )


@app.get("/analytics/monthly-sales", tags=["analytics"])
async def monthly_sales() -> list[dict]:
    return await run_query(
        """
        SELECT DATEFROMPARTS(YEAR(order_date), MONTH(order_date), 1) AS sales_month,
               SUM(sales_amount)                                     AS total_sales,
               COUNT(DISTINCT order_number)                          AS orders,
               SUM(quantity)                                         AS quantity
        FROM gold.fact_sales
        WHERE order_date IS NOT NULL
        GROUP BY DATEFROMPARTS(YEAR(order_date), MONTH(order_date), 1)
        ORDER BY sales_month
        """
    )


@app.get("/analytics/top-customers", tags=["analytics"])
async def top_customers(limit: int = Query(10, ge=1, le=100)) -> list[dict]:
    return await run_query(
        """
        SELECT TOP (?) c.customer_id,
               c.first_name + ' ' + c.last_name AS customer_name,
               c.country,
               SUM(f.sales_amount)              AS total_sales,
               COUNT(DISTINCT f.order_number)   AS orders
        FROM gold.fact_sales f
        JOIN gold.dim_customers c ON c.customer_key = f.customer_key
        GROUP BY c.customer_id, c.first_name, c.last_name, c.country
        ORDER BY total_sales DESC
        """,
        [limit],
    )


@app.get("/analytics/top-products", tags=["analytics"])
async def top_products(limit: int = Query(10, ge=1, le=100)) -> list[dict]:
    return await run_query(
        """
        SELECT TOP (?) p.product_number, p.product_name, p.category,
               SUM(f.sales_amount) AS total_sales,
               SUM(f.quantity)     AS quantity
        FROM gold.fact_sales f
        JOIN gold.dim_products p ON p.product_key = f.product_key
        GROUP BY p.product_number, p.product_name, p.category
        ORDER BY total_sales DESC
        """,
        [limit],
    )