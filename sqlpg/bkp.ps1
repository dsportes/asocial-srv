$1 = $args[0]
$2 = $args[1]
$env:PGPASSWORD = 'Pg35423542'; pg_dump asocial-$2 > ./pg$1$2.bk
ls -l ./
