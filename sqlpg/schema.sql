CREATE TABLE IF NOT EXISTS "singletons" (
  "id" text,
  "v" integer,
  "_data_"	bytea,
  PRIMARY KEY("id")
);

CREATE TABLE IF NOT EXISTS "taches" (
  "op" integer,
  "org" text,
  "id" text,
  "dh" integer,
  "exc"	text,
  "dhf" integer,
  "nb" integer,
  PRIMARY KEY("op", "org", "id")
);
CREATE INDEX IF NOT EXISTS "taches_dh" ON "taches" ( "dh" );

CREATE TABLE IF NOT EXISTS "espaces" (
  "id" text,
  "v" integer,
  "dpt" integer,
  "_data_"	bytea,
  PRIMARY KEY("id")
);
CREATE INDEX IF NOT EXISTS "espaces_dpt" ON "espaces" ( "dpt" );

CREATE TABLE IF NOT EXISTS "syntheses" (
  "id" text,
  "v" integer,
  "_data_"	bytea,
  PRIMARY KEY("id")
);

CREATE TABLE IF NOT EXISTS "fpurges" (
  "id" text,
  "_data_"	bytea,
  PRIMARY KEY("id")
);

CREATE TABLE IF NOT EXISTS "partitions" (
  "id" text,
  "v" integer,
  "_data_"	bytea,
  PRIMARY KEY("id")
);
CREATE INDEX IF NOT EXISTS "partitions_id_v" ON "partitions" ( "id", "v" );

CREATE TABLE IF NOT EXISTS "comptes" (
  "id" text,
  "v" integer,
  "hk" text,
  "_data_"	bytea,
  PRIMARY KEY("id")
);
CREATE INDEX IF NOT EXISTS "comptes_id_v" ON "comptes" ( "id", "v" );
CREATE INDEX IF NOT EXISTS "comptes_hk" ON "comptes" ( "hk" );

CREATE TABLE IF NOT EXISTS "comptas" (
  "id" text,
  "v" integer,
  "dlv" integer,
  "_data_"	bytea,
  PRIMARY KEY("id")
);
CREATE INDEX IF NOT EXISTS "comptas_id_v" ON "comptas" ( "id", "v" );
CREATE INDEX IF NOT EXISTS "comptas_dlv" ON "comptas" ( "dlv" );

CREATE TABLE IF NOT EXISTS "comptis" (
  "id" text,
  "v" integer,
  "_data_"	bytea,
  PRIMARY KEY("id")
);
CREATE INDEX IF NOT EXISTS "comptis_id_v" ON "comptis" ( "id", "v" );

CREATE TABLE IF NOT EXISTS "invits" (
  "id" text,
  "v" integer,
  "_data_"	bytea,
  PRIMARY KEY("id")
);
CREATE INDEX IF NOT EXISTS "invits_id_v" ON "invits" ( "id", "v" );

CREATE TABLE IF NOT EXISTS "versions" (
  "id" text,
  "v" integer,
  "dlv" integer,
  PRIMARY KEY("id")
);
CREATE INDEX IF NOT EXISTS "versions_id_v" ON "versions" ( "id", "v" );
CREATE INDEX IF NOT EXISTS "versions_dlv" ON "versions" ( "dlv" ) WHERE "dlv" > 0;

CREATE TABLE IF NOT EXISTS "avatars" (
  "id" text,
  "v" integer,
  "vcv" integer,
  "hk" text,
  "_data_"	bytea,
  PRIMARY KEY("id")
);
CREATE INDEX IF NOT EXISTS "avatars_id_v" ON "avatars" ( "id", "v" );
CREATE INDEX IF NOT EXISTS "avatars_id_vcv" ON "avatars" ( "id", "vcv" );
CREATE INDEX IF NOT EXISTS "avatars_hk" ON "avatars" ( "hk" ) WHERE "hk" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "chats" (
  "id" text,
  "ids" text,
  "v" integer,
  "_data_"	bytea,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX IF NOT EXISTS "chats_id_v" ON "chats" ( "id", "v" );

CREATE TABLE IF NOT EXISTS "notes" (
  "id" text,
  "ids" text,
  "v" integer,
  "_data_"	bytea,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX IF NOT EXISTS "notes_id_v" ON "notes" ( "id", "v" );

CREATE TABLE IF NOT EXISTS "tickets" (
  "id" text,
  "ids" text,
  "v"	integer,
  "dlv" integer,
  "_data_"	bytea,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX IF NOT EXISTS "tickets_id_v" ON "tickets" ( "id", "v" );
CREATE INDEX IF NOT EXISTS "tickets_dlv" ON "tickets" ( "dlv" );

CREATE TABLE IF NOT EXISTS "transferts" (
  "id" text,
  "dlv" integer,
  "_data_"	bytea,
  PRIMARY KEY("id")
);
CREATE INDEX IF NOT EXISTS "transferts_dlv" ON "transferts" ( "dlv" );

CREATE TABLE IF NOT EXISTS "sponsorings" (
  "id" text,
  "ids" text,
  "v" integer,
  "dlv" integer,
  "hk" text,
  "_data_"	bytea,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX IF NOT EXISTS "sponsorings_id_v" ON "sponsorings" ( "id", "v" );
CREATE INDEX IF NOT EXISTS "sponsorings_hk" ON "sponsorings" ( "hk" );
CREATE INDEX IF NOT EXISTS "sponsorings_dlv" ON "sponsorings" ( "dlv" );

CREATE TABLE IF NOT EXISTS "groupes" (
  "id" text,
  "v" integer,
  "dfh" integer,
  "_data_"	bytea,
  PRIMARY KEY("id")
);
CREATE INDEX IF NOT EXISTS "groupes_id_v" ON "groupes" ( "id", "v" );
CREATE INDEX IF NOT EXISTS "groupes_dfh" ON "groupes" ( "dfh" ) WHERE "dfh" > 0;

CREATE TABLE IF NOT EXISTS "membres" (
  "id" text,
  "ids" text,
  "v"  integer,
  "_data_"	bytea,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX IF NOT EXISTS "membres_id_v" ON "membres" ( "id", "v" );

CREATE TABLE IF NOT EXISTS "chatgrs" (
  "id" text,
  "ids" text,
  "v" integer,
  "_data_"	bytea,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX IF NOT EXISTS "chatgrs_id_v" ON "chatgrs" ( "id", "v" );
