import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InstallAppBanner from "./InstallAppBanner.jsx";
import {
  dismissInstallBanner,
  getInstallSnapshot,
  isInstallBannerDismissed,
  promptToInstall,
  subscribeToInstallState,
} from "../lib/install-prompt.js";

vi.mock("../lib/install-prompt.js", () => ({
  dismissInstallBanner: vi.fn(),
  getInstallSnapshot: vi.fn(),
  isInstallBannerDismissed: vi.fn(),
  promptToInstall: vi.fn(),
  subscribeToInstallState: vi.fn(),
}));

const installedSnapshot = {
  installed: false,
  canPrompt: false,
  ios: false,
  nativeSupported: true,
  eligible: true,
};

beforeEach(() => {
  getInstallSnapshot.mockReturnValue(installedSnapshot);
  isInstallBannerDismissed.mockReturnValue(false);
  promptToInstall.mockResolvedValue("accepted");
  subscribeToInstallState.mockReturnValue(() => {});
});

describe("InstallAppBanner", () => {
  it("opens the browser install prompt when it is available", async () => {
    getInstallSnapshot.mockReturnValue({ ...installedSnapshot, canPrompt: true });
    const onOpenGuide = vi.fn();
    render(<InstallAppBanner userId={7} onOpenGuide={onOpenGuide} />);

    fireEvent.click(screen.getByRole("button", { name: "Install app" }));

    await waitFor(() => expect(promptToInstall).toHaveBeenCalledTimes(1));
    expect(onOpenGuide).not.toHaveBeenCalled();
  });

  it("falls back to the install guide when no native prompt is available", () => {
    const onOpenGuide = vi.fn();
    render(<InstallAppBanner userId={7} onOpenGuide={onOpenGuide} />);

    fireEvent.click(screen.getByRole("button", { name: "View install steps" }));

    expect(onOpenGuide).toHaveBeenCalledTimes(1);
  });

  it("shows Home Screen guidance on iPhone and iPad", () => {
    getInstallSnapshot.mockReturnValue({ ...installedSnapshot, ios: true, nativeSupported: false });

    render(<InstallAppBanner userId={7} onOpenGuide={vi.fn()} />);

    expect(screen.getByText("Add WorkSpace to your Home Screen")).toBeInTheDocument();
    expect(screen.getByText(/enable notifications on iPhone or iPad/i)).toBeInTheDocument();
  });

  it("remembers dismissal for the signed-in user", () => {
    render(<InstallAppBanner userId={7} onOpenGuide={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss install app banner" }));

    expect(dismissInstallBanner).toHaveBeenCalledWith(7);
    expect(screen.queryByLabelText("Install WorkSpace")).not.toBeInTheDocument();
  });

  it("stays hidden when WorkSpace is already installed or the user dismissed it", () => {
    getInstallSnapshot.mockReturnValue({ ...installedSnapshot, installed: true });
    const first = render(<InstallAppBanner userId={7} onOpenGuide={vi.fn()} />);
    expect(screen.queryByLabelText("Install WorkSpace")).not.toBeInTheDocument();
    first.unmount();

    getInstallSnapshot.mockReturnValue(installedSnapshot);
    isInstallBannerDismissed.mockReturnValue(true);
    render(<InstallAppBanner userId={7} onOpenGuide={vi.fn()} />);
    expect(screen.queryByLabelText("Install WorkSpace")).not.toBeInTheDocument();
  });
});
