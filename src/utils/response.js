module.exports = {
  success(data, message = "عملیات با موفقیت انجام شد") {
    return {
      success: true,
      message,
      data,
    };
  },

  error(code, message) {
    return {
      success: false,
      code,
      message,
    };
  },
};
