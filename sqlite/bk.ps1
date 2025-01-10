$n = $args[0]
sqlite3 ./test.db3 ".backup ./test$n.bk"
ls -l ./
