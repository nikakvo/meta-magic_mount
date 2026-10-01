PROJECT = magic_mount
VERSION  ?= v1.0.0

# use zig cc
CC       := zig cc
STRIPPER := strip

# source files
SRCS     := utils.c ksu.c module_tree.c magic_mount.c main.c

# output directory
OUTDIR   := bin

# common flags
CFLAGS_COMMON := -std=c23 -D_POSIX_C_SOURCE=200809L -Wl,--gc-sections -static -Wpedantic -Werror
CFLAGS_COMMON += -DVERSION=\"$(VERSION)\"

LDFLAGS_COMMON := -static

# build mode specific flags
CFLAGS_RELEASE := -Oz -s -DNDEBUG
CFLAGS_DEBUG   := -O0 -g -DDEBUG

# zig target triples
TARGET_AMD64 ?= x86_64-linux
TARGET_ARM64 ?= aarch64-linux
TARGET_ARMV7 ?= arm-linux

# output binary names
BIN_AMD64 := $(OUTDIR)/mm_amd64
BIN_ARM64 := $(OUTDIR)/mm_arm64
BIN_ARMV7 := $(OUTDIR)/mm_armv7

BINS := $(BIN_AMD64) $(BIN_ARM64) $(BIN_ARMV7)

.PHONY: all clean release debug amd64 arm64 armv7 dirs help strip-bins check

# default target
all: release

help:
	@echo "Usage:"
	@echo "  make release [version=X.Y.Z]  - Build release version (optimized, stripped)"
	@echo "  make debug [version=X.Y.Z]    - Build debug version (with symbols)"
	@echo "  make check                    - Build for this machine and run the tests"
	@echo "  make clean                    - Clean build artifacts"
	@echo ""
	@echo "Individual targets:"
	@echo "  make amd64  - Build for x86_64"
	@echo "  make arm64  - Build for aarch64"
	@echo "  make armv7  - Build for armv7"

dirs:
	mkdir -p $(OUTDIR)

# Release build (default)
release: export CFLAGS := $(CFLAGS_COMMON) $(CFLAGS_RELEASE)
release: dirs $(BINS) strip-bins
	@echo "Release build completed: $(VERSION)"

# Debug build
debug: export CFLAGS := $(CFLAGS_COMMON) $(CFLAGS_DEBUG)
debug: dirs $(BINS)
	@echo "Debug build completed: $(VERSION)"

strip-bins:
	@echo "Stripping binaries..."
	@for bin in $(BINS); do \
		echo "  Stripping $$bin"; \
		$(STRIPPER) $$bin 2>/dev/null || echo "  (host strip cannot read $$bin, already stripped by -s)"; \
	done

amd64: $(BIN_AMD64)
arm64: $(BIN_ARM64)
armv7: $(BIN_ARMV7)

$(BIN_AMD64): $(SRCS)
	$(CC) -target $(TARGET_AMD64) $(CFLAGS) $^ -o $@ $(LDFLAGS_COMMON)

$(BIN_ARM64): $(SRCS)
	$(CC) -target $(TARGET_ARM64) $(CFLAGS) $^ -o $@ $(LDFLAGS_COMMON)

$(BIN_ARMV7): $(SRCS)
	$(CC) -target $(TARGET_ARMV7) $(CFLAGS) $^ -o $@ $(LDFLAGS_COMMON)

# Host build for the tests; kept out of $(OUTDIR), which is packaged
TESTDIR  := test-bin
BIN_HOST := $(TESTDIR)/mm_host

$(BIN_HOST): $(SRCS)
	mkdir -p $(TESTDIR)
	$(CC) -target native-linux-musl $(CFLAGS_COMMON) -O1 $(SRCS) -o $@ $(LDFLAGS_COMMON)

check: $(BIN_HOST)
	sh tests/dryrun.sh $(BIN_HOST)

clean:
	rm -rf $(OUTDIR) $(TESTDIR)
