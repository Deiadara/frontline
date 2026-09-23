-- No dashes in the game's own copy (maintainer, 2026-09-23).
--
-- An Overseer's biography is copied off the preset onto the row when the file is opened, so a
-- preset rewritten since then never reaches a file already on the shelf. The rows are read
-- through the preset now (`repos/overseers.ts`), and this cleans the copy on any row whose
-- preset has left the pool: an aside set off by a dash becomes a colon, a bare dash a comma.
-- The dashes are spelled by code point so the tree itself stays free of them.
UPDATE overseers SET bio = replace(bio, ' ' || char(8212) || ' ', ': ');
UPDATE overseers SET bio = replace(bio, ' ' || char(8211) || ' ', ': ');
UPDATE overseers SET bio = replace(bio, ' ' || char(45) || char(45) || ' ', ': ');
UPDATE overseers SET bio = replace(bio, char(8212), ', ');
UPDATE overseers SET bio = replace(bio, char(8211), ', ');
