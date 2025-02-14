#! /bin/bash
sqlite3 ./test$2.db3 ".restore ./test$1$2.bk"
ls -l ./
