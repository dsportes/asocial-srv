#! /bin/bash
psql -X asocial-$3 < ./pg$1$2.bk
ls -l ./
