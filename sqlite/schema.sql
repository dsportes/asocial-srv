CREATE TABLE IF NOT EXISTS "singletons" (
  "id"	INTEGER,
  "v" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
);
CREATE TABLE IF NOT EXISTS "espaces" (
  "id"	INTEGER,
  "org" TEXT,
  "v" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
) WITHOUT ROWID;
CREATE INDEX "espaces_org" ON "espaces" ( "org" );
CREATE TABLE IF NOT EXISTS "syntheses" (
  "id"	INTEGER,
  "v" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS "fpurges" (
  "id"	INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS "partitions" (
  "id"	INTEGER,
  "v" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
) WITHOUT ROWID;
CREATE INDEX "tribus_id_v" ON "partitions" ( "id", "v" );
CREATE TABLE IF NOT EXISTS "comptes" (
  "id"	INTEGER,
  "v" INTEGER,
  "hxr" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
) WITHOUT ROWID;
CREATE INDEX "comptes_id_v" ON "comptes" ( "id", "v" );
CREATE INDEX "comptes_hxr" ON "comptes" ( "hxr" );
CREATE TABLE IF NOT EXISTS "comptas" (
  "id"	INTEGER,
  "v" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
) WITHOUT ROWID;
CREATE INDEX "comptas_id_v" ON "comptas" ( "id", "v" );
CREATE TABLE IF NOT EXISTS "versions" (
  "id"	INTEGER,
  "v" INTEGER,
  "suppr" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
) WITHOUT ROWID;
CREATE INDEX "versions_id_v" ON "versions" ( "id", "v" );
CREATE INDEX "versions_dlv" ON "versions" ( "suppr" ) WHERE "suppr" > 0;
CREATE TABLE IF NOT EXISTS "avatars" (
  "id"	INTEGER,
  "v" INTEGER,
  "vcv" INTEGER,
  "hpc" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
) WITHOUT ROWID;
CREATE INDEX "avatars_id_v" ON "avatars" ( "id", "v" );
CREATE INDEX "avatars_id_vcv" ON "avatars" ( "id", "vcv" );
CREATE INDEX "avatars_hpc" ON "avatars" ( "hpc" ) WHERE "hpc" > 0;
CREATE TABLE IF NOT EXISTS "chats" (
  "id"	INTEGER,
  "ids"  INTEGER,
  "v" INTEGER,
  "vcv" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX "chats_id_v" ON "chats" ( "id", "v" );
CREATE INDEX "chats_id_vcv" ON "chats" ( "id", "vcv" );
CREATE TABLE IF NOT EXISTS "notes" (
  "id"	INTEGER,
  "ids"  INTEGER,
  "v" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX "notes_id_v" ON "notes" ( "id", "v" );
CREATE TABLE IF NOT EXISTS "tickets" (
  "id"	INTEGER,
  "ids"  INTEGER,
  "v"	INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id", "ids")
) WITHOUT ROWID;
CREATE INDEX "tickets_id_v" ON "tickets" ( "id", "v" );
CREATE TABLE IF NOT EXISTS "transferts" (
  "id"	 INTEGER,
  "ids"  INTEGER,
  "dlv"  INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX "transferts_dlv" ON "transferts" ( "dlv" );
CREATE TABLE IF NOT EXISTS "sponsorings" (
  "id"	 INTEGER,
  "ids"  INTEGER,
  "v"    INTEGER,
  "dlv"  INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX "sponsorings_id_v" ON "sponsorings" ( "id", "v" );
CREATE INDEX "sponsorings_ids" ON "sponsorings" ( "ids" );
CREATE INDEX "sponsorings_dlv" ON "sponsorings" ( "dlv" );
CREATE TABLE IF NOT EXISTS "groupes" (
  "id"	INTEGER,
  "v"   INTEGER,
  "dfh" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id")
) WITHOUT ROWID;
CREATE INDEX "groupes_id_v" ON "groupes" ( "id", "v" );
CREATE INDEX "groupes_dfh" ON "groupes" ( "dfh" ) WHERE "dfh" > 0;
CREATE TABLE IF NOT EXISTS "membres" (
  "id"	INTEGER,
  "ids"  INTEGER,
  "v"  INTEGER,
  "vcv" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX "membres_id_v" ON "membres" ( "id", "v" );
CREATE INDEX "membres_id_vcv" ON "membres" ( "id", "vcv" );
CREATE TABLE IF NOT EXISTS "chatgrs" (
  "id"	INTEGER,
  "ids"  INTEGER,
  "v" INTEGER,
  "_data_"	BLOB,
  PRIMARY KEY("id", "ids")
);
CREATE INDEX "chatgrs_id_v" ON "chatgrs" ( "id", "v" );