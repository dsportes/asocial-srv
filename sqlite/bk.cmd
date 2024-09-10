@echo off
sqlite3 test.db3 ".backup test%1.bk"
dir
