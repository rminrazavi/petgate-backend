# MOPET backend

Strapi 5 commerce backend for MOPET. **SEP (Saman Kish / Bank Melli Iran acquiring) is the only active payment provider.**

## SEP configuration

Set the placeholders in `.env.example` in the deployment environment. Required values are `SEP_TERMINAL_ID` and `SEP_CALLBACK_URL`; endpoint overrides are available for an approved SEP environment. Never commit credentials.

The implemented flow is: create an order, request a SEP token, POST `Token` to the SEP `OnlinePG` page, receive the provider POST callback with `ResNum` and `RefNum`, verify server-side by `RefNum`, then mark the payment successful and finalize inventory exactly once.

Amounts currently pass through from product price to order and SEP unchanged. The business currency unit still requires confirmation before live payments are enabled.

## Commands

```sh
npm test
npm run build
```

The supplied sandbox has no installed dependencies, so those commands must be run in CI or the deployment environment.
