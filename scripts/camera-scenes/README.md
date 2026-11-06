# Camera scenes

The scenes a person can lay behind themselves on camera (docs/systems/voice.md,
"Camera backgrounds"): Graphite, Tavern, Library, Night window and Greenhouse.

`scenes.mjs` draws each as SVG from shapes and a seeded random, so a scene comes
out the same every time: a room seen through a lens focused on the person in
front of it, soft, its lights turned into round blurs, lit from above in the
colour of the place, with nothing busy in the middle where the person sits.

`draw.mjs` renders them with Chrome and writes, for each, a 1280x720 JPEG (the
size the camera sends) and a 320x180 one for the picker into
`packages/web/src/camera/scenes/`. A picture over its budget fails the run.

```sh
npm install --prefix /tmp/camera-scenes playwright-core
PLAYWRIGHT_PREFIX=/tmp/camera-scenes node scripts/camera-scenes/draw.mjs
```

The system's Chrome is used (`CHROME_PATH` to name another). A new scene needs
an entry in `SCENES` here, its id in `SCENE_IDS` and its pictures in
`SCENE_PICTURES` (`packages/web/src/camera/`), and its name in the five
`settings.json` catalogs (`voice.video.background.choice.scene`).
