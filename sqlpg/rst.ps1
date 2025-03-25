$1 = $args[0]
$2 = $args[1]
$3 = $args[2]
$env:PGPASSWORD = 'Pg35423542'; Get-content ./pg$1$2.bk | psql -X asocial-$3
ls -l ./