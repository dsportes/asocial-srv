$1 = $args[0]
$2 = $args[1]
pg_dump asocial-$2 > ./pg$1$2.bk
ls -l ./
