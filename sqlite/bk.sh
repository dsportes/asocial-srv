#! /bin/bash
sqlite3 ./test.db3 ".backup ./test$1.bk"
ls -l ./
