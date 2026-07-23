import { EspoClient } from "../espo/client.js";
import { espoAuthorizationCredential } from "../espo/credential.js";

export async function authenticateEspoUser(baseUrl: string, username: string, password: string): Promise<string> {
  const client = new EspoClient(baseUrl, espoAuthorizationCredential(username, password));
  const appUser = await client.getAppUser();
  const token = appUser.token;

  return typeof token === "string" && token !== "" ? token : password;
}
