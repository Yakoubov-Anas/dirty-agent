"""Database manager backend.

Supports SQLite (stdlib sqlite3) and MySQL/MariaDB (pymysql, lazy-imported).
Connection specs (non-secret) persist to ~/.hermes/db_connections.json; MySQL
passwords go to ~/.hermes/.env (NEVER the JSON) under HERMES_DB_PASSWORD_<id>.

This module is the single source of truth for DB access; both the desktop
Database panel (via /api/db/* in web_server.py) and a future agent tool read
through it.
"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

from hermes_constants import get_hermes_home

from hermes_cli import db_engines
from hermes_cli.db_engines import DbError, driver_available, get_dialect

# Safety caps so a careless query can't hang the UI or exhaust memory.
DEFAULT_ROW_CAP = 1000
MAX_ROW_CAP = 10000

SUPPORTED_ENGINES = ("sqlite", "mysql")


def _connections_path() -> Path:
    return get_hermes_home() / "db_connections.json"


def _password_env_key(conn_id: str) -> str:
    return f"HERMES_DB_PASSWORD_{conn_id}"


def _load_connections() -> list[dict[str, Any]]:
    path = _connections_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _save_connections(connections: list[dict[str, Any]]) -> None:
    path = _connections_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(connections, indent=2), encoding="utf-8")


def list_connections() -> list[dict[str, Any]]:
    """Return all saved connection specs. Secrets are never included."""
    return _load_connections()


def _find_connection(conn_id: str) -> dict[str, Any]:
    for conn in _load_connections():
        if conn.get("id") == conn_id:
            return conn
    raise DbError(f"Connection not found: {conn_id}")


def _password_for(conn_id: str) -> str | None:
    from hermes_cli.config import get_env_value

    return get_env_value(_password_env_key(conn_id))


def driver_status(engine: str) -> dict[str, Any]:
    """Whether the engine's driver is available + the package needed to install."""
    engine = (engine or "").strip().lower()
    return {
        "engine": engine,
        "available": driver_available(engine),
        "package": db_engines.ENGINE_DRIVER_PACKAGE.get(engine),
    }


def install_driver(engine: str) -> dict[str, Any]:
    """pip-install the driver package for an engine (JetBrains-style on-demand)."""
    import subprocess
    import sys

    engine = (engine or "").strip().lower()
    package = db_engines.ENGINE_DRIVER_PACKAGE.get(engine)
    if not package:
        raise DbError(f"No installable driver for engine: {engine!r}")

    if driver_available(engine):
        return {"ok": True, "package": package, "alreadyInstalled": True}

    try:
        proc = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", package],
            capture_output=True,
            text=True,
            timeout=180,
        )
    except Exception as exc:  # noqa: BLE001
        raise DbError(f"Driver install failed: {exc}") from exc

    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[-400:]
        raise DbError(f"Driver install failed: {detail}")

    # importlib caches negative lookups; bust them so the new package is seen.
    import importlib

    importlib.invalidate_caches()

    return {"ok": True, "package": package, "alreadyInstalled": False}


def _build_spec(
    engine: str,
    name: str,
    file: str | None,
    host: str | None,
    port: int | None,
    database: str | None,
    user: str | None,
) -> dict[str, Any]:
    engine = (engine or "").strip().lower()
    conn_id = uuid.uuid4().hex

    if engine == "sqlite":
        path_str = (file or "").strip()
        if not path_str:
            raise DbError("SQLite connection needs a file path")
        db_path = Path(path_str).expanduser()
        if not db_path.exists():
            raise DbError(f"Database file not found: {db_path}")
        if not db_path.is_file():
            raise DbError(f"Not a file: {db_path}")
        return {
            "id": conn_id,
            "engine": "sqlite",
            "name": (name or db_path.name).strip() or db_path.name,
            "file": str(db_path),
        }

    if engine == "mysql":
        host = (host or "").strip() or "127.0.0.1"
        db_name = (database or "").strip()
        if not db_name:
            raise DbError("MySQL connection requires a database name")
        return {
            "id": conn_id,
            "engine": "mysql",
            "name": (name or db_name).strip() or db_name,
            "host": host,
            "port": int(port or 3306),
            "database": db_name,
            "user": (user or "").strip(),
        }

    raise DbError(f"Unsupported engine: {engine!r}")


def add_connection(
    engine: str,
    name: str = "",
    file: str | None = None,
    host: str | None = None,
    port: int | None = None,
    database: str | None = None,
    user: str | None = None,
    password: str | None = None,
) -> dict[str, Any]:
    """Add a connection spec. The MySQL password is stored in .env, not the spec."""
    if not driver_available(engine):
        raise DbError(f"Driver for {engine} is not installed")

    spec = _build_spec(engine, name, file, host, port, database, user)

    if spec["engine"] == "mysql" and password:
        from hermes_cli.config import save_env_value

        save_env_value(_password_env_key(spec["id"]), password)

    connections = _load_connections()
    connections.append(spec)
    _save_connections(connections)
    return spec


def remove_connection(conn_id: str) -> None:
    connections = _load_connections()
    next_connections = [c for c in connections if c.get("id") != conn_id]
    if len(next_connections) == len(connections):
        raise DbError(f"Connection not found: {conn_id}")
    _save_connections(next_connections)

    # Drop the stored password, if any.
    from hermes_cli.config import remove_env_value

    try:
        remove_env_value(_password_env_key(conn_id))
    except Exception:  # noqa: BLE001 — secret cleanup is best-effort
        pass


def test_connection(
    engine: str,
    host: str | None = None,
    port: int | None = None,
    database: str | None = None,
    user: str | None = None,
    password: str | None = None,
    file: str | None = None,
) -> dict[str, Any]:
    """Try to open a connection with the given (unsaved) params, then close it."""
    if not driver_available(engine):
        raise DbError(f"Driver for {engine} is not installed")

    spec = _build_spec(engine, "", file, host, port, database, user)
    dialect = get_dialect(spec["engine"])
    conn = dialect.connect(spec, password)
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.fetchall()
    finally:
        conn.close()
    return {"ok": True}


def _open(conn_spec: dict[str, Any]):
    dialect = get_dialect(conn_spec.get("engine", ""))
    password = _password_for(conn_spec["id"]) if conn_spec.get("engine") == "mysql" else None
    return dialect, dialect.connect(conn_spec, password)


def get_schema(conn_id: str) -> dict[str, Any]:
    """Return the database schema: tables (+ columns) and views."""
    conn = _find_connection(conn_id)
    dialect, sql_conn = _open(conn)
    try:
        cur = sql_conn.cursor()
        objects = dialect.list_objects(cur, conn)

        tables: list[dict[str, Any]] = []
        for name, obj_type in objects:
            columns = dialect.table_columns(cur, conn, name)
            tables.append({"name": name, "type": obj_type, "columns": columns})

        return {"tables": tables}
    finally:
        sql_conn.close()


def _row_to_list(row: Any) -> list[Any]:
    values = []
    for value in tuple(row):
        if isinstance(value, (bytes, bytearray)):
            values.append(f"<{len(value)} bytes>")
        else:
            values.append(value)
    return values


def run_query(conn_id: str, sql: str, limit: int | None = None) -> dict[str, Any]:
    """Execute arbitrary SQL. Returns columns + rows for result sets, or the
    affected row count for statements. Rows are capped for safety."""
    conn = _find_connection(conn_id)
    statement = (sql or "").strip()
    if not statement:
        raise DbError("Empty query")

    cap = DEFAULT_ROW_CAP if limit is None else max(1, min(int(limit), MAX_ROW_CAP))

    _dialect, sql_conn = _open(conn)
    started = time.monotonic()
    try:
        cur = sql_conn.cursor()
        try:
            cur.execute(statement)
        except Exception as exc:  # noqa: BLE001 — surface driver errors uniformly
            raise DbError(str(exc)) from exc

        elapsed_ms = int((time.monotonic() - started) * 1000)

        if cur.description is None:
            sql_conn.commit()
            return {
                "columns": [],
                "rows": [],
                "rowCount": cur.rowcount if cur.rowcount and cur.rowcount >= 0 else 0,
                "elapsedMs": elapsed_ms,
                "truncated": False,
            }

        columns = [d[0] for d in cur.description]
        fetched = cur.fetchmany(cap + 1)
        truncated = len(fetched) > cap
        rows = [_row_to_list(r) for r in fetched[:cap]]
        elapsed_ms = int((time.monotonic() - started) * 1000)

        return {
            "columns": columns,
            "rows": rows,
            "rowCount": len(rows),
            "elapsedMs": elapsed_ms,
            "truncated": truncated,
        }
    finally:
        sql_conn.close()


def get_table(conn_id: str, table: str, limit: int = 100, offset: int = 0) -> dict[str, Any]:
    """Paged SELECT * for a single table (the "double-click a table" view)."""
    conn = _find_connection(conn_id)
    name = (table or "").strip()
    if not name:
        raise DbError("No table specified")

    safe_limit = max(1, min(int(limit), MAX_ROW_CAP))
    safe_offset = max(0, int(offset))

    dialect, sql_conn = _open(conn)
    try:
        cur = sql_conn.cursor()
        if not dialect.table_exists(cur, conn, name):
            raise DbError(f"Table not found: {name}")

        is_view = dialect.is_view(cur, conn, name)
        primary_key = [] if is_view else dialect.primary_key(cur, conn, name)

        started = time.monotonic()
        ph = dialect.placeholder
        cur.execute(
            f"SELECT * FROM {dialect.quote(name)} LIMIT {ph} OFFSET {ph}",
            (safe_limit, safe_offset),
        )
        columns = [d[0] for d in cur.description]
        rows = [_row_to_list(r) for r in cur.fetchall()]
        elapsed_ms = int((time.monotonic() - started) * 1000)

        return {
            "columns": columns,
            "rows": rows,
            "rowCount": len(rows),
            "elapsedMs": elapsed_ms,
            "offset": safe_offset,
            "limit": safe_limit,
            "primaryKey": primary_key,
            "editable": bool(primary_key),
        }
    finally:
        sql_conn.close()


def update_cell(
    conn_id: str,
    table: str,
    column: str,
    value: Any,
    pk_values: dict[str, Any],
) -> dict[str, Any]:
    """Update a single cell, identified by the row's primary-key values."""
    conn = _find_connection(conn_id)
    name = (table or "").strip()
    col = (column or "").strip()
    if not name or not col:
        raise DbError("Table and column required")
    if not pk_values:
        raise DbError("This table has no primary key, so cells can't be edited")

    dialect, sql_conn = _open(conn)
    try:
        cur = sql_conn.cursor()
        if not dialect.table_exists(cur, conn, name):
            raise DbError(f"Table not found: {name}")

        valid = {c["name"] for c in dialect.table_columns(cur, conn, name)}
        if col not in valid:
            raise DbError(f"Unknown column: {col}")
        for pk in pk_values:
            if pk not in valid:
                raise DbError(f"Unknown key column: {pk}")

        ph = dialect.placeholder
        pk_cols = list(pk_values.keys())
        where = " AND ".join(f"{dialect.quote(pk)} = {ph}" for pk in pk_cols)
        params = [value, *[pk_values[pk] for pk in pk_cols]]

        try:
            cur.execute(f"UPDATE {dialect.quote(name)} SET {dialect.quote(col)} = {ph} WHERE {where}", params)
        except Exception as exc:  # noqa: BLE001
            raise DbError(str(exc)) from exc

        if cur.rowcount == 0:
            raise DbError("No matching row (it may have changed or been deleted)")
        if cur.rowcount and cur.rowcount > 1:
            sql_conn.rollback()
            raise DbError("Refused: the key matched multiple rows")

        sql_conn.commit()
        return {"ok": True, "updated": cur.rowcount}
    finally:
        sql_conn.close()


def delete_row(conn_id: str, table: str, pk_values: dict[str, Any]) -> dict[str, Any]:
    """Delete a single row identified by its primary-key values."""
    conn = _find_connection(conn_id)
    name = (table or "").strip()
    if not name:
        raise DbError("No table specified")
    if not pk_values:
        raise DbError("This table has no primary key, so rows can't be deleted")

    dialect, sql_conn = _open(conn)
    try:
        cur = sql_conn.cursor()
        if not dialect.table_exists(cur, conn, name):
            raise DbError(f"Table not found: {name}")

        valid = {c["name"] for c in dialect.table_columns(cur, conn, name)}
        for pk in pk_values:
            if pk not in valid:
                raise DbError(f"Unknown key column: {pk}")

        ph = dialect.placeholder
        pk_cols = list(pk_values.keys())
        where = " AND ".join(f"{dialect.quote(pk)} = {ph}" for pk in pk_cols)
        params = [pk_values[pk] for pk in pk_cols]

        try:
            cur.execute(f"DELETE FROM {dialect.quote(name)} WHERE {where}", params)
        except Exception as exc:  # noqa: BLE001
            raise DbError(str(exc)) from exc

        if cur.rowcount and cur.rowcount > 1:
            sql_conn.rollback()
            raise DbError("Refused: the key matched multiple rows")

        sql_conn.commit()
        return {"ok": True, "deleted": cur.rowcount}
    finally:
        sql_conn.close()
