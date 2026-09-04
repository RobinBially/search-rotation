## v0.3.0 — verlässliche Rotation und GitHub-Releases

Dieses Release korrigiert die Kontingent-Priorisierung und macht parallele MCP-Instanzen, den Token-Betrieb und die Fehlerbehandlung robuster.

### Neu

- Getrennte Such-/Fetch-Rotation, Cooldowns mit `Retry-After` und Gesamtzeitlimit mit Abbruchweitergabe.
- Optionaler strikter Gratis-Modus mit Reservierung laufender Einheiten innerhalb eines Routers.
- Tages-/Monats-/Credit-/IP-Kontingente mit sichtbarer Quelle und Schätzstatus.
- GitHub Actions für Tests unter Node 20/22/24 sowie GitHub-Releases mit fertigem Paket und SHA-256-Prüfsumme. Kein npm-Konto nötig.

### Behoben

- Erschöpfte Engines umgehen nicht mehr die Quota-Priorität.
- Prozessübergreifende Sperren verhindern verlorene Verbrauchszähler und Verlaufseinträge.
- Dashboard-Login mit Session-Cookie; keine langlebigen Tokens in URLs oder Logs. Host-/Origin-Schutz für die HTTP-Schnittstellen.
- Korrekte DDG-Snippets, zuverlässiges Drag-and-drop und getrennte Search-/Fetch-Tests im Dashboard.
- Alle Regressionstests sind Teil des Standard-Testlaufs; keine übersprungenen Bugtests.

### Installation

```sh
npx -y --allow-git=all github:RobinBially/search-rotation#v0.3.0
```

Alternativ das fertig gebaute `search-rotation-0.3.0.tgz` aus diesem Release installieren. npm/npx dienen nur als Paketwerkzeuge; ein npm-Account und npm-Publish sind nicht erforderlich.

### Update-Hinweise

Vorhandene Config- und Verlaufsdateien bleiben erhalten. Alte Serverprozesse vor dem Update beenden, damit alle Instanzen die neuen Dateisperren verwenden. Im Token-Betrieb erfolgt die Browser-Anmeldung nun über `/login`; `?token=…` entfällt. Token- und Portänderungen erfordern einen Neustart. Details und Grenzen des Gratis-Modus stehen in der README und in `docs/operations.md`.
