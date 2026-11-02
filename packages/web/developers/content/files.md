# Files

```bash
curl -X POST https://your.instance/api/bots/@me/files \
  -H "Authorization: Bot $TAVVIT_TOKEN" \
  -F "file=@report.pdf"
```

The answer is 201 with the attachment. It holds more than this, such as a picture's size:

```json
{ "id": "375271436524974080", "filename": "375271436524974080.pdf", "originalName": "report.pdf", "mimetype": "application/pdf", "size": 48213 }
```

Then name it in a message:

```json
{ "content": "Last month's report", "attachments": ["375271436524974080"] }
```

Sent to [`POST /api/channels/:id/messages`](/developers/docs/rest), which takes the `ATTACH_FILES` right. Show a picture inside a card by also naming it as the card's `imageAttachmentId`; see [cards](/developers/docs/cards).

## What holds

- **One file to a request,** as `multipart/form-data`, and 30 uploads a minute from one address.
- **The instance's size for one file.** Over it the answer is 413 `upload_too_large`.
- **Storage:** what your bots send counts on your own account, as if you had sent it yourself, so that five bots do not make five times the room. When it is full the answer is 413 `storage_limit_reached`. You see the figure under Settings → Account.
- **A full disk:** the answer is 507 `disk_full`. Try again later.
- **It has to be used.** A file no message names within the hour is removed.
- **It is only yours.** Naming a file another account uploaded answers `attachment_not_owned`.

A message's files go when the message goes.

## In a person's app

Pictures, video and audio are shown in the message, with a thumbnail where one can be made. Anything else is a file to download. Tavvit decides this by the file's name, so send `chart.png` rather than `chart`.
