#! /bin/bash
sqlite3 sqlite/test.db3 ".restore sqlite/test$1.bk"
ls -l sqlite
