export default ({ config }) => {
  const androidKey = process.env.GOOGLE_MAPS_ANDROID_KEY?.trim();
  return {
    ...config,
    ...(androidKey ? {
      android: {
        ...config.android,
        config: {
          ...config.android?.config,
          googleMaps: { apiKey: androidKey },
        },
      },
    } : {}),
  };
};
