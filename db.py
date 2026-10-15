"""Shared SQL Server connection helpers used by the pipeline and the API.

Connection settings come from environment variables (or a local .env file):

    DB_SERVER     SQL Server host, e.g. localhost or localhost\\SQLEXPRESS
    DB_NAME       database name (default: DataWarehouse)
    DB_USER       SQL login (not needed with Windows authentication)
    DB_PASSWORD   SQL password
    DB_TRUSTED    "yes" to use Windows authentication instead of DB_USER/DB_PASSWORD
    DB_DRIVER     ODBC driver name (default: ODBC Driver 18 for SQL Server)
"""
import os
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Sequence

from dotenv import load_dotenv

load_dotenv()


def _escape(value: str) -> str:
    """Wrap a value in braces so ';' and similar characters are safe in an ODBC string."""
    return "{" + value.replace("}", "}}") + "}"


def connection_string() -> str:
    driver = os.getenv("DB_DRIVER", "ODBC Driver 18 for SQL Server")
    server = os.getenv("DB_SERVER", "localhost")
    database = os.getenv("DB_NAME", "DataWarehouse")

    parts = [
        f"DRIVER={{{driver}}}",
        f"SERVER={server}",
        f"DATABASE={database}",
        "TrustServerCertificate=yes",  # fine for a local dev instance
    ]
    if os.getenv("DB_TRUSTED", "no").lower() in ("1", "yes", "true"):
        parts.append("Trusted_Connection=yes")
    else:
        user = os.getenv("DB_USER")
        password = os.getenv("DB_PASSWORD")
        if not user or password is None:
            raise RuntimeError(
                "Set DB_USER and DB_PASSWORD (or DB_TRUSTED=yes) in your .env file."
            )
        parts.append(f"UID={_escape(user)}")
        parts.append(f"PWD={_escape(password)}")
    return ";".join(parts) + ";"


@contextmanager
def connection(autocommit: bool = False) -> Iterator[Any]:
    """Open a connection and always close it, even if the caller raises."""
    import pyodbc  # imported lazily so tests can run without the ODBC driver installed

    conn = pyodbc.connect(connection_string(), autocommit=autocommit, timeout=30)
    try:
        yield conn
    finally:
        conn.close()


def query(sql: str, params: Sequence[Any] = ()) -> List[Dict[str, Any]]:
    """Run a SELECT with bound parameters and return rows as a list of dicts."""
    with connection() as conn:
        cursor = conn.cursor()
        cursor.execute(sql, list(params))
        columns = [col[0] for col in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]
