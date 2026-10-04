"use strict";

module.exports = {
  routes: [
    {
      method: "POST",
      path: "/auth/send-otp",
      handler: "auth-otp.sendOtp",
      config: { auth: false },
    },
    {
      method: "POST",
      path: "/auth/verify-otp",
      handler: "auth-otp.verifyOtp",
      config: { auth: false },
    },
    {
      method: "GET",
      path: "/auth/me",
      handler: "auth-otp.me",
      config: { auth: {} },
    },
    {
      method: "POST",
      path: "/auth/logout",
      handler: "auth-otp.logout",
      config: { auth: false },
    },
  ],
};
