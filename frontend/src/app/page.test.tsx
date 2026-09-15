import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("home page", () => {
  it("renders the product name", () => {
    render(<HomePage />);
    expect(screen.getByText("PARCHÍS ONLINE")).toBeInTheDocument();
  });
});
