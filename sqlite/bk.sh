#! /bin/bash
sqlite3 ./test$2.db3 ".backup ./test$1$2.bk"
ls -l ./
