# Overview

Tavvit has two ways for a program to take part in a space.

| | Webhook | Bot |
|---|---|---|
| **What it is** | An address that posts into one channel | A program with an account of its own |
| **It can** | Post text and cards | Read, write, react, moderate, answer commands, send files |
| **It hears** | Nothing | What happens in the channels it can see |
| **You need** | Nothing but something that can send a request | A program that runs |
| **Made by** | Whoever may manage webhooks in that channel | Anyone with an account, if the instance allows bots |

A build server telling a channel that a deploy finished is a [webhook](/developers/docs/webhooks). Anything that answers people is a bot.

## Start here

1. Follow the [quickstart](/developers/docs/quickstart): a bot that writes in a channel, in five minutes.
2. Have it [listen on the socket](/developers/docs/socket), so it can answer.
3. Give it [commands](/developers/docs/commands), so people can ask it things.

There is a whole [example bot](/developers/assets/example-bot.mjs) in one file with no dependencies, which does all of this.

## Where it talks to

Every request goes to the instance your bot lives on:

```text
https://your.instance/api
wss://your.instance/ws
```

Tavvit is self-hosted software, so there can be many instances. A bot belongs to the one it was made on and can join spaces there. The examples in these docs show the address of the instance you are reading them on.

An instance's operator has to allow bots. Without that, making one and every request of one answer `bots_disabled`.

## What is closed, for good

A token opens [a short list of routes](/developers/docs/rest) and nothing else. Accounts, mail, sign-in, two factors, administration, direct messages and friends cannot be reached by a program, whatever it asks. A new route is closed to bots until someone decides otherwise. See [tokens](/developers/docs/authentication).
