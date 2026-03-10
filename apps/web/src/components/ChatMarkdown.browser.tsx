import "../index.css";

import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import ChatMarkdown from "./ChatMarkdown";

describe("ChatMarkdown", () => {
  it("renders a copy button for blockquotes", async () => {
    const screen = await render(
      <ChatMarkdown
        text={"> Texto sugerido\n>\n> 1. Primer punto\n> 2. Segundo punto"}
        cwd={undefined}
      />,
    );

    await expect.element(page.getByRole("button", { name: "Copy text" })).toBeInTheDocument();

    await screen.unmount();
  });
});
