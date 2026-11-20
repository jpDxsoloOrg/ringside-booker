#!/usr/bin/env python3
"""Writes fictional workshop world mod folders for the Choose a folder tour (UNITY-34).

    python3 game/tools/make-fictional-mod-folders.py <out dir>

Every database is built from the fictional test world (the tables in
game/Assets/Tests/Saves/Fixtures/fictional-world-mod.json, with the column types of
packages/engine-host/test/worldModFixture.ts). Nothing comes from a real mod. It writes:

  <out>/Testverse Classic/            one mod: fictional.db + an empty picture folder
  <out>/Several worlds/North/         a folder of two mods (no picture folders)
  <out>/Several worlds/South/
  <out>/Not a mod/                    pictures and a readme, but no database
"""
import json
import os
import re
import shutil
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
FIXTURE = os.path.join(REPO, "game", "Assets", "Tests", "Saves", "Fixtures", "fictional-world-mod.json")
SCHEMA_SOURCE = os.path.join(REPO, "packages", "engine-host", "test", "worldModFixture.ts")


def schema():
    text = open(SCHEMA_SOURCE, encoding="utf-8").read()
    match = re.search(r"const SCHEMA = `(.*?)`;", text, re.S)
    if not match:
        sys.exit("SCHEMA not found in " + SCHEMA_SOURCE)
    return match.group(1)


def write_database(path, tables, world_name):
    if os.path.exists(path):
        os.remove(path)
    db = sqlite3.connect(path)
    db.executescript(schema())
    for table, rows in tables.items():
        for row in rows:
            if table == "gameworld":
                row = dict(row, worldName=world_name)
            columns = list(row.keys())
            db.execute(
                f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
                [row[column] for column in columns],
            )
    db.commit()
    db.close()


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    out = os.path.abspath(sys.argv[1])
    tables = json.load(open(FIXTURE, encoding="utf-8"))["tables"]
    picture_folder = tables["gameworld"][0]["imageFolder"]
    if os.path.isdir(out):
        shutil.rmtree(out)

    single = os.path.join(out, "Testverse Classic")
    os.makedirs(os.path.join(single, picture_folder))
    write_database(os.path.join(single, "fictional.db"), tables, "Testverse Classic")

    for name in ("North", "South"):
        folder = os.path.join(out, "Several worlds", name)
        os.makedirs(folder)
        write_database(os.path.join(folder, "fictional.db"), tables, f"Testverse {name}")

    not_a_mod = os.path.join(out, "Not a mod")
    os.makedirs(os.path.join(not_a_mod, picture_folder))
    with open(os.path.join(not_a_mod, "readme.txt"), "w", encoding="utf-8") as readme:
        readme.write("A folder with pictures but no world database.\n")
    print(out)


if __name__ == "__main__":
    main()
