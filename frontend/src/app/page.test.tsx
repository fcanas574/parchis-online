import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HomePage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("home page", () => {
  it("renders the product name", () => {
    render(<HomePage />);
    expect(screen.getByText("PARCHÍS ONLINE")).toBeInTheDocument();
  });
});
