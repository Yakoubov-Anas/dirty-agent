import sqlite3
from pathlib import Path

import pytest

from hermes_cli import db_manager
from hermes_cli.db_manager import DbError


@pytest.fixture
def hermes_home(tmp_path, monkeypatch):
    # Point connection storage at a temp HERMES_HOME so tests don't touch real config.
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    return tmp_path


@pytest.fixture
def sample_db(tmp_path):
    db_path = tmp_path / "sample.db"
    con = sqlite3.connect(str(db_path))
    con.execute("CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER)")
    con.executemany("INSERT INTO users(name, age) VALUES (?, ?)", [("alice", 30), ("bob", 25)])
    con.execute("CREATE VIEW adults AS SELECT * FROM users WHERE age >= 18")
    con.commit()
    con.close()
    return db_path


def test_add_list_remove_connection(hermes_home, sample_db):
    spec = db_manager.add_connection("sqlite", "Sample", str(sample_db))
    assert spec["engine"] == "sqlite"
    assert spec["name"] == "Sample"
    assert spec["file"] == str(sample_db)
    assert spec["id"]

    assert len(db_manager.list_connections()) == 1

    db_manager.remove_connection(spec["id"])
    assert db_manager.list_connections() == []


def test_add_connection_rejects_missing_file(hermes_home, tmp_path):
    with pytest.raises(DbError):
        db_manager.add_connection("sqlite", "Missing", str(tmp_path / "nope.db"))


def test_add_connection_rejects_non_sqlite(hermes_home, sample_db):
    with pytest.raises(DbError):
        db_manager.add_connection("postgres", "PG", str(sample_db))


def test_get_schema_lists_tables_and_views(hermes_home, sample_db):
    spec = db_manager.add_connection("sqlite", "Sample", str(sample_db))
    schema = db_manager.get_schema(spec["id"])
    names = {t["name"]: t for t in schema["tables"]}

    assert "users" in names
    assert "adults" in names
    assert names["users"]["type"] == "table"
    assert names["adults"]["type"] == "view"

    cols = {c["name"]: c for c in names["users"]["columns"]}
    assert set(cols) == {"id", "name", "age"}
    assert cols["id"]["pk"] is True
    assert cols["name"]["notnull"] is True


def test_run_query_select(hermes_home, sample_db):
    spec = db_manager.add_connection("sqlite", "Sample", str(sample_db))
    result = db_manager.run_query(spec["id"], "SELECT id, name FROM users ORDER BY id")

    assert result["columns"] == ["id", "name"]
    assert result["rows"] == [[1, "alice"], [2, "bob"]]
    assert result["rowCount"] == 2
    assert result["truncated"] is False


def test_run_query_caps_rows(hermes_home, sample_db):
    spec = db_manager.add_connection("sqlite", "Sample", str(sample_db))
    result = db_manager.run_query(spec["id"], "SELECT * FROM users", limit=1)

    assert result["rowCount"] == 1
    assert result["truncated"] is True


def test_run_query_mutation_reports_rowcount(hermes_home, sample_db):
    spec = db_manager.add_connection("sqlite", "Sample", str(sample_db))
    result = db_manager.run_query(spec["id"], "UPDATE users SET age = age + 1")

    assert result["columns"] == []
    assert result["rowCount"] == 2


def test_run_query_error_raises_dberror(hermes_home, sample_db):
    spec = db_manager.add_connection("sqlite", "Sample", str(sample_db))
    with pytest.raises(DbError):
        db_manager.run_query(spec["id"], "SELECT * FROM nonexistent")


def test_get_table_pagination(hermes_home, sample_db):
    spec = db_manager.add_connection("sqlite", "Sample", str(sample_db))
    page = db_manager.get_table(spec["id"], "users", limit=1, offset=1)

    assert page["rowCount"] == 1
    assert page["offset"] == 1
    assert page["rows"][0][1] == "bob"


def test_get_table_rejects_unknown_table(hermes_home, sample_db):
    spec = db_manager.add_connection("sqlite", "Sample", str(sample_db))
    with pytest.raises(DbError):
        db_manager.get_table(spec["id"], "definitely_not_here")


def test_get_table_reports_primary_key_and_editable(hermes_home, sample_db):
    spec = db_manager.add_connection("sqlite", "Sample", str(sample_db))
    page = db_manager.get_table(spec["id"], "users")

    assert page["primaryKey"] == ["id"]
    assert page["editable"] is True


def test_get_table_view_not_editable(hermes_home, sample_db):
    spec = db_manager.add_connection("sqlite", "Sample", str(sample_db))
    page = db_manager.get_table(spec["id"], "adults")

    assert page["primaryKey"] == []
    assert page["editable"] is False


def test_update_cell(hermes_home, sample_db):
    spec = db_manager.add_connection("sqlite", "Sample", str(sample_db))
    result = db_manager.update_cell(spec["id"], "users", "name", "alicia", {"id": 1})

    assert result["updated"] == 1
    check = db_manager.run_query(spec["id"], "SELECT name FROM users WHERE id = 1")
    assert check["rows"] == [["alicia"]]


def test_update_cell_rejects_no_pk(hermes_home, sample_db):
    spec = db_manager.add_connection("sqlite", "Sample", str(sample_db))
    with pytest.raises(DbError):
        db_manager.update_cell(spec["id"], "users", "name", "x", {})


def test_update_cell_rejects_unknown_column(hermes_home, sample_db):
    spec = db_manager.add_connection("sqlite", "Sample", str(sample_db))
    with pytest.raises(DbError):
        db_manager.update_cell(spec["id"], "users", "nope", "x", {"id": 1})


def test_delete_row(hermes_home, sample_db):
    spec = db_manager.add_connection("sqlite", "Sample", str(sample_db))
    result = db_manager.delete_row(spec["id"], "users", {"id": 2})

    assert result["deleted"] == 1
    count = db_manager.run_query(spec["id"], "SELECT COUNT(*) AS c FROM users")
    assert count["rows"][0][0] == 1


# ─── Engines / drivers ─────────────────────────────────────────────────────


def test_driver_status_sqlite_always_available():
    status = db_manager.driver_status("sqlite")
    assert status["available"] is True


def test_driver_status_mysql_reports_package():
    status = db_manager.driver_status("mysql")
    assert status["package"] == "pymysql"
    assert status["engine"] == "mysql"


def test_add_mysql_keeps_password_out_of_spec(hermes_home, monkeypatch):
    # Pretend the driver is installed so add_connection accepts it (we never
    # actually connect in this test).
    monkeypatch.setattr(db_manager, "driver_available", lambda engine: True)

    spec = db_manager.add_connection(
        engine="mysql",
        name="prod",
        host="db.example.com",
        port=3306,
        database="app",
        user="root",
        password="s3cret",
    )

    # The persisted spec carries NO password.
    assert "password" not in spec
    assert spec["host"] == "db.example.com"
    assert spec["database"] == "app"

    raw = (hermes_home / "db_connections.json").read_text(encoding="utf-8")
    assert "s3cret" not in raw

    # The password lives in the env store and is retrievable for connecting.
    from hermes_cli.config import get_env_value, invalidate_env_cache

    invalidate_env_cache()
    assert get_env_value(f"HERMES_DB_PASSWORD_{spec['id']}") == "s3cret"


def test_remove_mysql_clears_password(hermes_home, monkeypatch):
    monkeypatch.setattr(db_manager, "driver_available", lambda engine: True)
    spec = db_manager.add_connection(
        engine="mysql", name="x", host="h", database="d", user="u", password="pw"
    )

    db_manager.remove_connection(spec["id"])

    from hermes_cli.config import get_env_value, invalidate_env_cache

    invalidate_env_cache()
    assert get_env_value(f"HERMES_DB_PASSWORD_{spec['id']}") is None


def test_add_mysql_requires_database(hermes_home, monkeypatch):
    monkeypatch.setattr(db_manager, "driver_available", lambda engine: True)
    with pytest.raises(DbError):
        db_manager.add_connection(engine="mysql", name="x", host="h", user="u")
