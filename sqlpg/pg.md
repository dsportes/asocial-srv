
# Installation

    sudo apt install postgresql

    sudo -u postgres psql template1
    template1=# ALTER USER postgres with encrypted password 'Pg35423542';
        
## Dans postgesql.conf

    listen_addresses = 'localhost'

## Dans pg_hba.conf

    hostssl template1       postgres        localhost/24        scram-sha-256

## Start / restart / stop service

    sudo systemctl restart postgresql.service

## Install client

    sudo apt install postgresql-client
    # test
    psql --host localhost --username postgres --password --dbname template1
        
## Install PgAdmin

    sudo apt install postgresql-contrib -y
    curl  -fsSL https://www.pgadmin.org/static/packages_pgadmin_org.pub | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/pgadmin.gpg
    sudo sh -c 'echo "deb https://ftp.postgresql.org/pub/pgadmin/pgadmin4/apt/$(lsb_release -cs) pgadmin4 main" > /etc/apt/sources.list.d/pgadmin4.list'
    
    # Vérification
    cat /etc/apt/sources.list.d/pgadmin4.list
    >>> deb https://ftp.postgresql.org/pub/pgadmin/pgadmin4/apt/bullseye pgadmin4 main
    
    sudo apt update
    sudo apt install pgadmin4
    
    sudo /usr/pgadmin4/bin/setup-web.sh
    >>>Email address: daniel@sportes.fr
    >>>Pasword: Pg35423542
    
    sudo ufw allow http && sudo ufw allow https
    
    # Ouvrir la page: http://localhost/pgadmin4
    ## Login: daniel@sportes.fr
    ## Password: Pg35423542
    
    Add Server: lui donner comme nom "Local", user: postgres pwd: Pg35423542

# Développement
### `schema.sql`
Même schéma que pour sqlite avec les différences suivantes:
- les types `INTEGER` et `TEXT` ont été mis en minuscule.
- le type `BLOB` a été remplacé par `bytea`.

