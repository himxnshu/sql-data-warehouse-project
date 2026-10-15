"""
ETL pipeline runner for the SQL Server data warehouse.

What it does
    1. (optional) Runs bronze.load_bronze   -> loads the raw CSV files
    2. Runs        silver.load_silver       -> cleans and standardizes the data
    3. Validates   Silver + Gold            -> row counts, duplicate keys, orphan facts

Gold is made of views, so there is nothing to "load": it always reads fresh Silver data.

Usage (run from the project root)
    python -m pipeline.run_pipeline                 # bronze + silver + validation
    python -m pipeline.run_pipeline --skip-bronze   # silver + validation only

Exit code is 0 on success and 1 on failure, so a scheduler (Task Scheduler, cron,
GitHub Actions) can tell whether the run worked.
"""

import argparse
import logging
import sys
import time
from pathlib import Path

import pyodbc

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))  # lets `import db` work however the script is started

from db import connection  # noqa: E402  (shared connection helper, reads .env)

LOG_DIR = ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / "pipeline.log", encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("pipeline")

SILVER_TABLES = [
    "silver.crm_cust_info",
    "silver.crm_prd_info",
    "silver.crm_sales_details",
    "silver.erp_cust_az12",
    "silver.erp_loc_a101",
    "silver.erp_px_cat_g1v2",
]


class PipelineError(Exception):
    """Raised when a pipeline step or a data-quality check fails."""


def procedure_exists(conn: pyodbc.Connection, name: str) -> bool:
    row = conn.cursor().execute("SELECT OBJECT_ID(?, 'P')", name).fetchone()
    return row[0] is not None


def run_procedure(conn: pyodbc.Connection, name: str) -> None:
    """Execute a stored procedure, log its PRINT output, and fail loudly on errors."""
    log.info("Running %s ...", name)
    started = time.perf_counter()
    cursor = conn.cursor()
    messages: list[str] = []

    try:
        cursor.execute(f"SET NOCOUNT ON; EXEC {name}")
        # PRINT output arrives as "messages" and is only complete once every
        # result set has been consumed, so we walk through them all.
        more = True
        while more:
            messages.extend(text for _state, text in cursor.messages)
            more = cursor.nextset()
        messages.extend(text for _state, text in cursor.messages)
    except pyodbc.Error as exc:
        raise PipelineError(f"{name} failed: {exc}") from exc

    for line in messages:
        # SQL Server prefixes messages with the driver name, e.g. "[Microsoft][ODBC Driver...]"
        log.info("    %s", line.split("]")[-1].strip())

    # silver.load_silver catches its own errors and only PRINTs them, so Python would
    # otherwise think it succeeded. Look for its error banner explicitly.
    if any("ERROR OCCURED" in line.upper() or "ERROR OCCURRED" in line.upper() for line in messages):
        raise PipelineError(f"{name} reported an error (see log lines above)")

    log.info("Finished %s in %.1f s", name, time.perf_counter() - started)


def scalar(cursor: pyodbc.Cursor, sql: str) -> int:
    return cursor.execute(sql).fetchone()[0]


def validate(conn: pyodbc.Connection) -> None:
    """Basic data-quality checks. Raises PipelineError if a hard check fails."""
    log.info("Validating Silver and Gold layers ...")
    cursor = conn.cursor()
    problems: list[str] = []

    # 1. Silver tables must not be empty
    for table in SILVER_TABLES:
        count = scalar(cursor, f"SELECT COUNT(*) FROM {table}")
        log.info("    %-28s %9s rows", table, f"{count:,}")
        if count == 0:
            problems.append(f"{table} is empty")

    # 2. Dimensions must have unique business keys (otherwise facts get duplicated)
    dup_customers = scalar(
        cursor,
        "SELECT COUNT(*) - COUNT(DISTINCT customer_id) FROM gold.dim_customers",
    )
    dup_products = scalar(
        cursor,
        "SELECT COUNT(*) - COUNT(DISTINCT product_number) FROM gold.dim_products",
    )
    log.info("    duplicate customer ids in gold.dim_customers: %d", dup_customers)
    log.info("    duplicate product numbers in gold.dim_products: %d", dup_products)
    if dup_customers:
        problems.append(f"gold.dim_customers has {dup_customers} duplicate customer_id values")
    if dup_products:
        problems.append(f"gold.dim_products has {dup_products} duplicate product_number values")

    # 3. The fact view must not gain or lose rows compared with Silver (fan-out check)
    silver_sales = scalar(cursor, "SELECT COUNT(*) FROM silver.crm_sales_details")
    fact_sales = scalar(cursor, "SELECT COUNT(*) FROM gold.fact_sales")
    log.info("    silver sales rows: %d | gold.fact_sales rows: %d", silver_sales, fact_sales)
    if silver_sales != fact_sales:
        problems.append(
            f"gold.fact_sales has {fact_sales} rows but silver.crm_sales_details has {silver_sales}"
        )

    # 4. Orphan facts are only a warning (LEFT JOIN keeps them on purpose)
    orphan_customers = scalar(cursor, "SELECT COUNT(*) FROM gold.fact_sales WHERE customer_key IS NULL")
    orphan_products = scalar(cursor, "SELECT COUNT(*) FROM gold.fact_sales WHERE product_key IS NULL")
    if orphan_customers or orphan_products:
        log.warning(
            "    orphan facts: %d without customer, %d without product",
            orphan_customers,
            orphan_products,
        )

    if problems:
        raise PipelineError("Validation failed: " + "; ".join(problems))
    log.info("Validation passed")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the data warehouse ETL pipeline.")
    parser.add_argument(
        "--skip-bronze",
        action="store_true",
        help="do not run bronze.load_bronze (use when raw data is already loaded)",
    )
    args = parser.parse_args()

    started = time.perf_counter()
    log.info("=" * 60)
    log.info("Pipeline started")

    try:
        with connection(autocommit=True) as conn:
            if args.skip_bronze:
                log.info("Skipping Bronze load (--skip-bronze)")
            elif procedure_exists(conn, "bronze.load_bronze"):
                run_procedure(conn, "bronze.load_bronze")
            else:
                log.warning("bronze.load_bronze not found, skipping Bronze load")

            run_procedure(conn, "silver.load_silver")
            validate(conn)
    except (PipelineError, pyodbc.Error, RuntimeError) as exc:  # RuntimeError: missing .env settings
        log.error("Pipeline FAILED: %s", exc)
        return 1

    log.info("Pipeline finished successfully in %.1f s", time.perf_counter() - started)
    return 0


if __name__ == "__main__":
    sys.exit(main())
