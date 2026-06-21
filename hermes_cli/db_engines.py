"""Database engine dialects.

Each dialect adapts a DB-API 2.0 driver (stdlib sqlite3, or pymysql for MySQL)
to a uniform interface the db_manager uses for schema introspection, querying,
and PK-based edits. Drivers are imported lazily so a missing one only matters
when that engine is actually used (JetBrains-style "install driver on demand").
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol


class DbError(Exception):
    """A user-facing database error (bad spec, SQL error, missing driver/file)."""


# Engine → the PyPI package its driver lives in (for install-on-demand).
ENGINE_DRIVER_PACKAGE = {
    "mysql": "pymysql",
}


def driver_available(engine: str) -> bool:
    """True when the engine needs no extra driver (sqlite) or its driver imports."""
    engine = (engine or "").strip().lower()
    if engine == "sqlite":
        return True

    package = ENGINE_DRIVER_PACKAGE.get(engine)
    if not package:
        return False

    import importlib.util

    return importlib.util.find_spec(package) is not None


class Dialect(Protocol):
    name: str
    placeholder: str  # parameter marker: '?' (sqlite) or '%s' (mysql)

    def quote(self, ident: str) -> str: ...
    def connect(self, spec: dict[str, Any], password: str | None) -> Any: ...
    def list_objects(self, cur: Any, spec: dict[str, Any]) -> list[tuple[str, str]]: ...
    def table_columns(self, cur: Any, spec: dict[str, Any], table: str) -> list[dict[str, Any]]: ...
    def primary_key(self, cur: Any, spec: dict[str, Any], table: str) -> list[str]: ...
    def is_view(self, cur: Any, spec: dict[str, Any], table: str) -> bool: ...


# ─── SQLite ────────────────────────────────────────────────────────────────


class SqliteDialect:
    name = "sqlite"
    placeholder = "?"

    def quote(self, ident: str) -> str:
        return '"' + ident.replace('"', '""') + '"'

    def connect(self, spec: dict[str, Any], password: str | None) -> Any:
        import sqlite3

        db_path = Path(spec.get("file", "")).expanduser()
        if not db_path.exists():
            raise DbError(f"Database file not found: {db_path}")
        conn = sqlite3.connect(str(db_path), timeout=15)
        conn.row_factory = sqlite3.Row
        return conn

    def list_objects(self, cur: Any, spec: dict[str, Any]) -> list[tuple[str, str]]:
        cur.execute(
            "SELECT name, type FROM sqlite_master "
            "WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' "
            "ORDER BY type, name"
        )
        return [(row[0], row[1]) for row in cur.fetchall()]

    def table_columns(self, cur: Any, spec: dict[str, Any], table: str) -> list[dict[str, Any]]:
        cur.execute(f'PRAGMA table_info({self.quote(table)})')
        return [
            {
                "name": col[1],
                "type": col[2] or "",
                "notnull": bool(col[3]),
                "pk": bool(col[5]),
            }
            for col in cur.fetchall()
        ]

    def primary_key(self, cur: Any, spec: dict[str, Any], table: str) -> list[str]:
        cur.execute(f'PRAGMA table_info({self.quote(table)})')
        pk = [(col[5], col[1]) for col in cur.fetchall() if col[5]]
        pk.sort(key=lambda item: item[0])
        return [name for _, name in pk]

    def is_view(self, cur: Any, spec: dict[str, Any], table: str) -> bool:
        cur.execute("SELECT type FROM sqlite_master WHERE name = ?", (table,))
        row = cur.fetchone()
        return bool(row) and row[0] == "view"

    def table_exists(self, cur: Any, spec: dict[str, Any], table: str) -> bool:
        cur.execute(
            "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?",
            (table,),
        )
        return cur.fetchone() is not None


# ─── MySQL / MariaDB (pymysql) ───────────────────────────────────────────────


class MysqlDialect:
    name = "mysql"
    placeholder = "%s"

    def quote(self, ident: str) -> str:
        return "`" + ident.replace("`", "``") + "`"

    def connect(self, spec: dict[str, Any], password: str | None) -> Any:
        try:
            import pymysql
        except ImportError as exc:  # pragma: no cover - exercised via driver_available
            raise DbError("MySQL driver (pymysql) is not installed") from exc

        try:
            return pymysql.connect(
                host=spec.get("host") or "127.0.0.1",
                port=int(spec.get("port") or 3306),
                user=spec.get("user") or "",
                password=password or "",
                database=spec.get("database") or None,
                connect_timeout=10,
                read_timeout=15,
                write_timeout=15,
                charset="utf8mb4",
            )
        except Exception as exc:  # noqa: BLE001 — driver raises many error types
            raise DbError(str(exc)) from exc

    def _schema(self, spec: dict[str, Any]) -> str:
        schema = spec.get("database")
        if not schema:
            raise DbError("MySQL connection requires a database name")
        return schema

    def list_objects(self, cur: Any, spec: dict[str, Any]) -> list[tuple[str, str]]:
        cur.execute(
            "SELECT table_name, table_type FROM information_schema.tables "
            "WHERE table_schema = %s ORDER BY table_type, table_name",
            (self._schema(spec),),
        )
        out: list[tuple[str, str]] = []
        for row in cur.fetchall():
            name, table_type = row[0], row[1]
            kind = "view" if str(table_type).upper() == "VIEW" else "table"
            out.append((name, kind))
        return out

    def table_columns(self, cur: Any, spec: dict[str, Any], table: str) -> list[dict[str, Any]]:
        cur.execute(
            "SELECT column_name, column_type, is_nullable, column_key "
            "FROM information_schema.columns "
            "WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position",
            (self._schema(spec), table),
        )
        return [
            {
                "name": col[0],
                "type": col[1] or "",
                "notnull": str(col[2]).upper() == "NO",
                "pk": str(col[3]).upper() == "PRI",
            }
            for col in cur.fetchall()
        ]

    def primary_key(self, cur: Any, spec: dict[str, Any], table: str) -> list[str]:
        cur.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = %s AND table_name = %s AND column_key = 'PRI' "
            "ORDER BY ordinal_position",
            (self._schema(spec), table),
        )
        return [row[0] for row in cur.fetchall()]

    def is_view(self, cur: Any, spec: dict[str, Any], table: str) -> bool:
        cur.execute(
            "SELECT table_type FROM information_schema.tables "
            "WHERE table_schema = %s AND table_name = %s",
            (self._schema(spec), table),
        )
        row = cur.fetchone()
        return bool(row) and str(row[0]).upper() == "VIEW"

    def table_exists(self, cur: Any, spec: dict[str, Any], table: str) -> bool:
        cur.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_schema = %s AND table_name = %s",
            (self._schema(spec), table),
        )
        return cur.fetchone() is not None


_DIALECTS: dict[str, Dialect] = {
    "sqlite": SqliteDialect(),
    "mysql": MysqlDialect(),
}


def get_dialect(engine: str) -> Dialect:
    dialect = _DIALECTS.get((engine or "").strip().lower())
    if dialect is None:
        raise DbError(f"Unsupported engine: {engine!r}")
    return dialect
