$1 = $args[0]
$2 = $args[1]
sqlite3 ./test$2.db3 ".backup ./test$1$2.bk"
ls -l ./
