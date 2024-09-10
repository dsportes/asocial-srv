@echo off
sqlite3 test.db3 ".restore test%1.bk"
dir