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

  it("renders path links as normal links", async () => {
    const screen = await render(
      <ChatMarkdown text={"[/some/path/like/this](/some/path/like/this)"} cwd={undefined} />,
    );

    const link = page.getByRole("link", { name: "/some/path/like/this" });

    await expect.element(link).toHaveAttribute("href", "/some/path/like/this");
    await expect.element(link).toHaveAttribute("target", "_blank");
    await expect.element(link).toHaveAttribute("rel", "noreferrer");

    await screen.unmount();
  });

  it("marks inline code as copyable", async () => {
    const screen = await render(
      <ChatMarkdown text={"Use `one-line code` here."} cwd={undefined} />,
    );

    await expect.element(page.getByRole("button", { name: "Copy code" })).toBeInTheDocument();

    await screen.unmount();
  });
});
