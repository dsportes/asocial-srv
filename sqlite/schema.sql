CREATE TABLE IF NOT EXISTS "singletons" (
  "id" TEXT,
  "v" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
);

CREATE TABLE IF NOT EXISTS "taches" (
  "op" INTEGER,
  "org" TEXT,
  "id" TEXT,
  "dh" INTEGER,
  "exc"	TEXT,
  "dhf" INTEGER,
  "nb" INTEGER,
  PRIMARY KEY("op", "org", "id")
);
CREATE INDEX "taches_dh" ON "taches" ( "dh" );

CREATE TABLE IF NOT EXISTS "espaces" (
  "id" TEXT,
  "v" INTEGER,
  "dpt" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
);
CREATE INDEX "espaces_dpt" ON "espaces" ( "dpt" );

CREATE TABLE IF NOT EXISTS "syntheses" (
  "id" TEXT,
  "v" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
);

CREATE TABLE IF NOT EXISTS "fpurges" (
  "id" TEXT,
  "_data_"	BLOB,
  PRIMARY KEY("id")
);

CREATE TABLE IF NOT EXISTS "partitions" (
  "id" TEXT,
  "v" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
);
CREATE INDEX "partitions_id_v" ON "partitions" ( "id", "v" );

CREATE TABLE IF NOT EXISTS "comptes" (
  "id" TEXT,
  "v" INTEGER,
  "hk" TEXT,
  "_data_"	BLOB,
  PRIMARY KEY("id")
);
CREATE INDEX "comptes_id_v" ON "comptes" ( "id", "v" );
CREATE INDEX "comptes_hk" ON "comptes" ( "hk" );

CREATE TABLE IF NOT EXISTS "comptas" (
  "id" TEXT,
  "v" INTEGER,
  "dlv" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
);
CREATE INDEX "comptas_id_v" ON "comptas" ( "id", "v" );
CREATE INDEX "comptas_dlv" ON "comptas" ( "dlv" );

CREATE TABLE IF NOT EXISTS "comptis" (
  "id" TEXT,
  "v" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
);
CREATE INDEX "comptis_id_v" ON "comptis" ( "id", "v" );

CREATE TABLE IF NOT EXISTS "invits" (
  "id" TEXT,
  "v" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
);
CREATE INDEX "invits_id_v" ON "invits" ( "id", "v" );

CREATE TABLE IF NOT EXISTS "versions" (
  "id" TEXT,
  "v" INTEGER,
  "dlv" INTEGER,
  PRIMARY KEY("id")
);
CREATE INDEX "versions_id_v" ON "versions" ( "id", "v" );
CREATE INDEX "versions_dlv" ON "versions" ( "dlv" ) WHERE "dlv" > 0;

CREATE TABLE IF NOT EXISTS "avatars" (
  "id" TEXT,
  "v" INTEGER,
  "vcv" INTEGER,
  "hk" TEXT,
  "_data_"	BLOB,
  PRIMARY KEY("id")
);
CREATE INDEX "avatars_id_v" ON "avatars" ( "id", "v" );
CREATE INDEX "avatars_id_vcv" ON "avatars" ( "id", "vcv" );
CREATE INDEX "avatars_hk" ON "avatars" ( "hk" ) WHERE "hk" > 0;

CREATE TABLE IF NOT EXISTS "chats" (
  "id" TEXT,
  "ids" TEXT,
  "v" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX "chats_id_v" ON "chats" ( "id", "v" );

CREATE TABLE IF NOT EXISTS "notes" (
  "id" TEXT,
  "ids" TEXT,
  "v" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX "notes_id_v" ON "notes" ( "id", "v" );

CREATE TABLE IF NOT EXISTS "tickets" (
  "id" TEXT,
  "ids" TEXT,
  "v"	INTEGER,
  "dlv" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX "tickets_id_v" ON "tickets" ( "id", "v" );
CREATE INDEX "tickets_dlv" ON "tickets" ( "dlv" );

CREATE TABLE IF NOT EXISTS "transferts" (
  "id" TEXT,
  "dlv" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
);
CREATE INDEX "transferts_dlv" ON "transferts" ( "dlv" );

CREATE TABLE IF NOT EXISTS "sponsorings" (
  "id" TEXT,
  "ids" TEXT,
  "v" INTEGER,
  "dlv" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX "sponsorings_id_v" ON "sponsorings" ( "id", "v" );
CREATE INDEX "sponsorings_ids" ON "sponsorings" ( "ids" );
CREATE INDEX "sponsorings_dlv" ON "sponsorings" ( "dlv" );

CREATE TABLE IF NOT EXISTS "groupes" (
  "id" TEXT,
  "v" INTEGER,
  "dfh" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
);
CREATE INDEX "groupes_id_v" ON "groupes" ( "id", "v" );
CREATE INDEX "groupes_dfh" ON "groupes" ( "dfh" ) WHERE "dfh" > 0;

CREATE TABLE IF NOT EXISTS "membres" (
  "id" TEXT,
  "ids" TEXT,
  "v"  INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX "membres_id_v" ON "membres" ( "id", "v" );

CREATE TABLE IF NOT EXISTS "chatgrs" (
  "id" TEXT,
  "ids" TEXT,
  "v" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX "chatgrs_id_v" ON "chatgrs" ( "id", "v" );
