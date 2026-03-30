import { db } from "@/server/db";

interface LinearGraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function fetchLinear<T>(accessToken: string, query: string, variables?: Record<string, unknown>) {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await response.json()) as LinearGraphQLResponse<T>;

  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join(", "));
  }

  if (!json.data) {
    throw new Error("Linear returned an empty response");
  }

  return json.data;
}

export async function getLinearAccount(userId: string) {
  return db.account.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: "linear",
      },
    },
  });
}
