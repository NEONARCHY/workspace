"""A fake Office executor for HTTP tests; real placement has separate adapter tests."""

from sqlalchemy import select, update

from yuksalish_api.tables import ai_referent_configuration


async def pass_preflight(client, engine, letter_id, user_headers, agent_token):
    base = "/api/v1/ai-referent"
    current = (await client.get(f"{base}/letters/{letter_id}", headers=user_headers)).json()
    check = current["documentCheck"]
    assert check is not None
    if check["status"] == "passed":
        return
    headers = {"X-AI-Referent-Agent-Token": agent_token}
    async with engine.begin() as connection:
        previous = await connection.scalar(select(ai_referent_configuration.c.execution_agent_id))
        await connection.execute(
            update(ai_referent_configuration).values(execution_agent_id="preflight-test")
        )
    try:
        for _ in range(100):
            response = await client.post(
                f"{base}/agent/document-checks/claim?agentId=preflight-test", headers=headers
            )
            assert response.status_code == 200, response.text
            job = response.json()["check"]
            assert job is not None
            response = await client.post(
                f"{base}/agent/document-checks/{job['id']}/result",
                headers=headers,
                json={
                    "agentId": "preflight-test",
                    "leaseToken": job["leaseToken"],
                    "reviewerKeys": [entry["key"] for entry in job["reviewers"]],
                },
            )
            assert response.status_code == 200, response.text
            if job["id"] == check["id"]:
                return
        raise AssertionError("Expected document check was not claimed")
    finally:
        async with engine.begin() as connection:
            await connection.execute(
                update(ai_referent_configuration).values(execution_agent_id=previous)
            )
