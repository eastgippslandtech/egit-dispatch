export function getServerlessPostgresOptions(
  ssl: "require" | false = "require",
) {
  return {
    connect_timeout: 10,
    idle_timeout: 5,
    max: 1,
    max_lifetime: 10 * 60,
    prepare: false,
    ssl,
  } as const;
}
