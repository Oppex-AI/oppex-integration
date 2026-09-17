// A minimal JSON reader and writer.
//
// This SDK's only external dependency is libcurl, and adding a JSON library
// would double that for one small object in each direction: a flat request
// payload and a four-field response envelope. Both are implemented here and
// covered directly by tests.
//
// The reader is a complete JSON parser rather than a field scanner, because the
// envelope can legitimately carry nested values this SDK ignores, and skipping
// them correctly needs real parsing.
//
// Not public API.

#ifndef OPPEX_SRC_JSON_HPP
#define OPPEX_SRC_JSON_HPP

#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace oppex::json {

class Value;

using Object = std::map<std::string, Value, std::less<>>;
using Array = std::vector<Value>;

/// A parsed JSON value. Objects and arrays are held indirectly so Value stays a
/// complete type inside its own alternatives.
class Value {
 public:
  using Storage = std::variant<std::nullptr_t, bool, double, std::string, std::shared_ptr<Array>,
                               std::shared_ptr<Object>>;

  Value() = default;
  explicit Value(Storage storage) : storage_(std::move(storage)) {}

  [[nodiscard]] const Object* AsObject() const;
  [[nodiscard]] std::optional<bool> AsBool() const;
  [[nodiscard]] std::optional<std::int64_t> AsInt() const;
  [[nodiscard]] const std::string* AsString() const;

 private:
  Storage storage_;
};

/// Parses a complete JSON document. Returns nullopt when the text is not valid
/// JSON, or carries trailing content.
[[nodiscard]] std::optional<Value> Parse(std::string_view text);

/// Appends value as a JSON string literal, including the surrounding quotes.
/// Control characters are escaped, and invalid UTF-8 bytes are replaced rather
/// than emitted raw, so the result is always well-formed JSON.
void AppendEscaped(std::string& out, std::string_view value);

}  // namespace oppex::json

#endif  // OPPEX_SRC_JSON_HPP
