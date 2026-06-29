# The walk-away handover kit

A repeatable way to set a small business up on Blockson, hand them a site they can
edit themselves, and **leave — for good**, with no string running back to you.

This kit exists for one reason: a walk-away handover isn't real because you *intend*
to walk away. It's real only when **your absence changes nothing** about whether the
site keeps serving and stays editable. The danger is almost never the code — it's
*whose name the accounts are in*. If the domain, repo, or host live in your account,
you are the client's secret dependency no matter how you frame it. This kit is
written to close every one of those, on purpose.

It's the natural extension of [`OPERATOR.md`](../../OPERATOR.md) (the developer deploy
guide): OPERATOR tells you how the engine and editor work; this tells you how to hand
them over so completely that any other developer — or nobody at all — can take it
from here.

## The promise you're actually making

> Your website's source, host, and domain are all yours. The editor that changes it
> is free and open-source — **any** web developer can run it, not just the person who
> set it up. The day I disappear, nothing about your site changes.

That last clause is *structurally true* here in a way it can never be on Wix or
Squarespace, because the engine is MIT-licensed and public. Say it out loud in the
pitch — it's the one thing the subscription platforms can't offer.

## The three steps

| Step | Doc | What it secures |
|---|---|---|
| 1. Accounts first | [`1-account-setup.md`](1-account-setup.md) | Domain, repo, and host all in the **client's** name before you touch a file |
| 2. On-site install | [`2-install-runbook.md`](2-install-runbook.md) | The editor on their machine, a scoped push credential, a one-click launcher, a verified live Publish |
| 3. Break-glass sheet | [`3-owner-break-glass-sheet.md`](3-owner-break-glass-sheet.md) | A plain-language page the owner keeps, so a dead PC or a future developer never means "call the person who built it" |

Work them in order. Step 1 is the one people skip and the one that quietly turns
"walk away" into "on call forever." Don't skip it.

The owner's one-click editor is the [`owner-launcher`](../../extras/owner-launcher/README.md)
(a clean app window, no console, installed in step 2). A later, optional stage —
folding Node into a single signed `.exe` so the machine needs no Node install — is
specified in [`4-sea-build.md`](4-sea-build.md) as a build-it-next handoff.

## The test you must pass before you leave

Before you close the door, you should be able to answer **yes** to all four:

1. If my GitHub/Cloudflare/Netlify account were deleted tonight, does their site still
   serve and still publish? *(Accounts are theirs → yes.)*
2. If their office PC dies, can they — or any local tech — rebuild the editor from the
   break-glass sheet without me? *(Sheet + public engine → yes.)*
3. Is the domain registered to **them**, renewable without me?
4. Does their contact form deliver to **their** inbox through **their** host, not a
   service tied to my account?

If any answer is "no," you haven't walked away — you've just left quietly while still
holding a key. Fix it before you go.
