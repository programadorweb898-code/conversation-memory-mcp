const { expect } = require("chai")
const { extractConfirmedMessageId } = require("../plugins/save-confirmation.js")

describe("saveMessage confirmation", () => {
  it("returns the message ID for a successful save", () => {
    const id = extractConfirmedMessageId({
      content: [{ type: "text", text: "Mensaje guardado correctamente. ID: msg-123" }],
    })

    expect(id).to.equal("msg-123")
  })

  it("rejects MCP errors", () => {
    expect(() =>
      extractConfirmedMessageId({
        isError: true,
        content: [{ type: "text", text: "database unavailable" }],
      })
    ).to.throw("database unavailable")
  })

  it("rejects successful responses without a message ID", () => {
    expect(() =>
      extractConfirmedMessageId({
        content: [{ type: "text", text: "Mensaje guardado correctamente" }],
      })
    ).to.throw("saveMessage no devolvió un ID de mensaje")
  })

  it("rejects an empty MCP error response", () => {
    expect(() =>
      extractConfirmedMessageId({ isError: true, content: [] })
    ).to.throw("saveMessage devolvió un error")
  })
})
