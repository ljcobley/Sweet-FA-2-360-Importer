# Sweet FA 2 360 Importer

A Google Chrome extension that allows you to seamlessly import **FA Full-Time football fixtures** into your **360Player team calendar**.

## Features

- Scrape fixtures directly from FA Full-Time pages.
- Export fixtures to CSV with correct headers.
- Bulk import CSV into 360Player team calendars.
- CSV validation with clear error feedback for missing columns or malformed rows.
- Preview import: see all events before importing in a modal popup.
- Confirmation dialog before import, showing identified "my team", target calendar, and number of events.
- Import progress display and final success/failure confirmation.
- Clickable event summary (date and title) after import.
- Options for private/public events, meeting times, and adding new admins/players automatically when they are added to the team.

## Installation

1. Download or clone this repository.
2. Open **chrome://extensions/** in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this project folder.
5. The extension will appear in your toolbar.

## Usage

1. Navigate to an FA Full-Time page that contains a fixtures widget.
2. Open the extension popup and generate the CSV export.
3. Switch to the 360Player team calendar portal.
4. Use the Bulk Import popup to paste or push the CSV into 360Player.
5. Preview the import in a modal popup and confirm details (team, calendar, number of events).
6. Watch progress as events are imported, then review the clickable summary of imported events.
7. Sit back as fixtures are created automatically in your calendar.

## Icons

Custom flat vector icons included (16x16, 32x32, 48x48, 128x128).

## License

MIT License
