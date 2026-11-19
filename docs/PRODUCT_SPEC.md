# Product specification: version 1

## Finalized requirements

- The application is a single-user Telegram bot with access restricted to explicitly configured Telegram usernames. User-facing text is Armenian. It is not a Mini App.
- Provide a compact supplier dashboard and supplier search. Add suppliers through the Telegram command menu.
- Support an Order → Waiting → History workflow. Order and Waiting lists use binary checklists with pagination. Checked Order items move to Waiting; unchecked items remain in Order. Checked Waiting items move to History; unchecked items remain in Waiting. Waiting items can also be returned or removed manually.
- Each supplier has one combined Waiting list and one combined editable note.
- A supplier may have multiple active price lists. Store files in Google Drive and their metadata in SQLite.
- Support optional supplier-specific fixed recurring and weekday reminders, including recovery of missed reminders.
- Provide order and receiving history; global history search is out of scope.

## Details still to be decided

Exact dashboard layout, pagination size, item fields, editing and removal behavior, history presentation, reminder timing and missed-reminder recovery policy, Drive organization, and deployment and backup procedures remain open. Do not infer additional business rules from this document.
