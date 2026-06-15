{
  description = "Development Nix flake for Cotect";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, rust-overlay, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      forAllSystems = f: nixpkgs.lib.genAttrs systems f;
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ rust-overlay.overlays.default ];
          };

          rust = pkgs.rust-bin.stable.latest.default.override {
            extensions = [ "rust-src" "rust-analyzer" ];
          };
          gstreamerPackages = with pkgs.gst_all_1; [
            gstreamer
            gst-plugins-base
            gst-plugins-good
            gst-plugins-bad
            gst-plugins-ugly
            gst-libav
          ];
        in
        {
          default = pkgs.mkShell {
            buildInputs = with pkgs; [
              # Frontend
              nodejs_22
              yarn

              # Rust / Tauri
              rust
              cargo-tauri

              # Build tooling
              pkg-config
              openssl
              openssl.dev

              # Tauri / WebKitGTK Linux dependencies
              webkitgtk_4_1
              gtk3
              glib
              glib.dev
              glib-networking
              gsettings-desktop-schemas
              shared-mime-info
              cairo
              pango
              gdk-pixbuf
              atk
              libayatana-appindicator
              librsvg
              dbus
              libxkbcommon
              libglvnd
              mesa
              libsoup_3
              xdotool
            ] ++ gstreamerPackages;

            PKG_CONFIG_PATH = "${pkgs.openssl.dev}/lib/pkgconfig";

            shellHook = ''
              export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules"
              export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share:${pkgs.gtk3}/share:${pkgs.shared-mime-info}/share:$XDG_DATA_DIRS"

              # Build a local combined GSettings schema dir for GTK/WebKit/Tauri.
              export GSETTINGS_SCHEMA_DIR="$PWD/.nix-gsettings-schemas"
              mkdir -p "$GSETTINGS_SCHEMA_DIR"

              cp -f ${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}/glib-2.0/schemas/*.xml "$GSETTINGS_SCHEMA_DIR"/ 2>/dev/null || true
              cp -f ${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}/glib-2.0/schemas/*.xml "$GSETTINGS_SCHEMA_DIR"/ 2>/dev/null || true

              ${pkgs.glib.dev}/bin/glib-compile-schemas "$GSETTINGS_SCHEMA_DIR"

              export GST_PLUGIN_SYSTEM_PATH_1_0="${pkgs.gst_all_1.gst-plugins-base}/lib/gstreamer-1.0:${pkgs.gst_all_1.gst-plugins-good}/lib/gstreamer-1.0:${pkgs.gst_all_1.gst-plugins-bad}/lib/gstreamer-1.0:${pkgs.gst_all_1.gst-plugins-ugly}/lib/gstreamer-1.0:${pkgs.gst_all_1.gst-libav}/lib/gstreamer-1.0"
              echo "Cotect development shell"
              echo "node:  $(node --version)"
              echo "yarn:  $(yarn --version)"
              echo "rustc: $(rustc --version)"
              echo "cargo: $(cargo --version)"
            '';
          };
        }
      );
    };
}
