$1 = $args[0]
$2 = $args[1]
$3 = $args[2]
psql -X asocial-$3 < ./pg$1$2.bk
ls -l ./