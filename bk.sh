#! /bin/bash
sqlite3 sqlite/test.db3 ".backup sqlite/test$1.bk"
ls -l sqlite
