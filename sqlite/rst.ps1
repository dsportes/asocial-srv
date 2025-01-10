$n = $args[0]
sqlite3 ./test.db3 ".restore ./test$n.bk"
ls -l ./
