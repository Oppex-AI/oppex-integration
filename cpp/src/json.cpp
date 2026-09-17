#include "json.hpp"

#include <array>
#include <cctype>
#include <charconv>
#include <cmath>
#include <cstdio>
#include <limits>

namespace oppex::json {
namespace {

/// A single pass over the text. Every Parse* member either consumes a complete
/// value and returns it, or returns nullopt and leaves the parser failed.
class Parser {
 public:
  explicit Parser(std::string_view text) : text_(text) {}

  std::optional<Value> ParseDocument() {
    SkipWhitespace();
    auto value = ParseValue(0);
    if (!value) {
      return std::nullopt;
    }
    SkipWhitespace();
    return position_ == text_.size() ? value : std::nullopt;
  }

 private:
  /// Guards against a document nested deeply enough to exhaust the stack. A
  /// hostile or broken proxy is exactly the source this parser reads from.
  static constexpr int kMaxDepth = 64;

  std::optional<Value> ParseValue(int depth) {
    if (depth > kMaxDepth || position_ >= text_.size()) {
      return std::nullopt;
    }
    switch (text_[position_]) {
      case '{':
        return ParseObject(depth);
      case '[':
        return ParseArray(depth);
      case '"': {
        auto text = ParseString();
        return text ? std::optional<Value>(Value(Value::Storage(std::move(*text)))) : std::nullopt;
      }
      case 't':
        return ParseLiteral("true", Value(Value::Storage(true)));
      case 'f':
        return ParseLiteral("false", Value(Value::Storage(false)));
      case 'n':
        return ParseLiteral("null", Value(Value::Storage(nullptr)));
      default:
        return ParseNumber();
    }
  }

  std::optional<Value> ParseLiteral(std::string_view literal, Value value) {
    if (text_.compare(position_, literal.size(), literal) != 0) {
      return std::nullopt;
    }
    position_ += literal.size();
    return value;
  }

  std::optional<Value> ParseNumber() {
    const std::size_t start = position_;
    if (position_ < text_.size() && text_[position_] == '-') {
      ++position_;
    }
    while (position_ < text_.size() &&
           (std::isdigit(static_cast<unsigned char>(text_[position_])) != 0 ||
            text_[position_] == '.' || text_[position_] == 'e' || text_[position_] == 'E' ||
            text_[position_] == '+' || text_[position_] == '-')) {
      ++position_;
    }
    if (position_ == start) {
      return std::nullopt;
    }

    double number = 0;
    const auto* first = text_.data() + start;
    const auto* last = text_.data() + position_;
    if (std::from_chars(first, last, number).ptr != last) {
      return std::nullopt;
    }
    return Value(Value::Storage(number));
  }

  std::optional<std::string> ParseString() {
    if (position_ >= text_.size() || text_[position_] != '"') {
      return std::nullopt;
    }
    ++position_;

    std::string out;
    while (position_ < text_.size()) {
      const char character = text_[position_++];
      if (character == '"') {
        return out;
      }
      if (character != '\\') {
        // A raw control character is invalid JSON; anything else passes through
        // as the bytes it already is, UTF-8 included.
        if (static_cast<unsigned char>(character) < 0x20) {
          return std::nullopt;
        }
        out.push_back(character);
        continue;
      }
      if (!ParseEscape(out)) {
        return std::nullopt;
      }
    }
    return std::nullopt;
  }

  bool ParseEscape(std::string& out) {
    if (position_ >= text_.size()) {
      return false;
    }
    const char escape = text_[position_++];
    switch (escape) {
      case '"':
      case '\\':
      case '/':
        out.push_back(escape);
        return true;
      case 'b':
        out.push_back('\b');
        return true;
      case 'f':
        out.push_back('\f');
        return true;
      case 'n':
        out.push_back('\n');
        return true;
      case 'r':
        out.push_back('\r');
        return true;
      case 't':
        out.push_back('\t');
        return true;
      case 'u':
        return ParseUnicodeEscape(out);
      default:
        return false;
    }
  }

  bool ParseUnicodeEscape(std::string& out) {
    auto first = ReadHexQuad();
    if (!first) {
      return false;
    }
    std::uint32_t code_point = *first;

    // A surrogate pair is two escapes. A lone surrogate is not valid UTF-8, so
    // it becomes the replacement character rather than an invalid byte sequence.
    if (code_point >= 0xD800 && code_point <= 0xDBFF && text_.compare(position_, 2, "\\u") == 0) {
      const std::size_t saved = position_;
      position_ += 2;
      auto low = ReadHexQuad();
      if (low && *low >= 0xDC00 && *low <= 0xDFFF) {
        code_point = 0x10000 + ((code_point - 0xD800) << 10) + (*low - 0xDC00);
      } else {
        position_ = saved;
        code_point = 0xFFFD;
      }
    } else if (code_point >= 0xD800 && code_point <= 0xDFFF) {
      code_point = 0xFFFD;
    }

    AppendUtf8(out, code_point);
    return true;
  }

  std::optional<std::uint32_t> ReadHexQuad() {
    if (position_ + 4 > text_.size()) {
      return std::nullopt;
    }
    std::uint32_t value = 0;
    const auto* first = text_.data() + position_;
    const auto* last = first + 4;
    if (std::from_chars(first, last, value, 16).ptr != last) {
      return std::nullopt;
    }
    position_ += 4;
    return value;
  }

  static void AppendUtf8(std::string& out, std::uint32_t code_point) {
    if (code_point < 0x80) {
      out.push_back(static_cast<char>(code_point));
    } else if (code_point < 0x800) {
      out.push_back(static_cast<char>(0xC0 | (code_point >> 6)));
      out.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
    } else if (code_point < 0x10000) {
      out.push_back(static_cast<char>(0xE0 | (code_point >> 12)));
      out.push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3F)));
      out.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
    } else {
      out.push_back(static_cast<char>(0xF0 | (code_point >> 18)));
      out.push_back(static_cast<char>(0x80 | ((code_point >> 12) & 0x3F)));
      out.push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3F)));
      out.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
    }
  }

  std::optional<Value> ParseObject(int depth) {
    ++position_;  // '{'
    auto object = std::make_shared<Object>();
    SkipWhitespace();
    if (Consume('}')) {
      return Value(Value::Storage(std::move(object)));
    }

    while (true) {
      SkipWhitespace();
      auto key = ParseString();
      if (!key) {
        return std::nullopt;
      }
      SkipWhitespace();
      if (!Consume(':')) {
        return std::nullopt;
      }
      SkipWhitespace();
      auto value = ParseValue(depth + 1);
      if (!value) {
        return std::nullopt;
      }
      object->insert_or_assign(std::move(*key), std::move(*value));

      SkipWhitespace();
      if (Consume(',')) {
        continue;
      }
      return Consume('}') ? std::optional<Value>(Value(Value::Storage(std::move(object))))
                          : std::nullopt;
    }
  }

  std::optional<Value> ParseArray(int depth) {
    ++position_;  // '['
    auto array = std::make_shared<Array>();
    SkipWhitespace();
    if (Consume(']')) {
      return Value(Value::Storage(std::move(array)));
    }

    while (true) {
      SkipWhitespace();
      auto value = ParseValue(depth + 1);
      if (!value) {
        return std::nullopt;
      }
      array->push_back(std::move(*value));

      SkipWhitespace();
      if (Consume(',')) {
        continue;
      }
      return Consume(']') ? std::optional<Value>(Value(Value::Storage(std::move(array))))
                          : std::nullopt;
    }
  }

  bool Consume(char expected) {
    if (position_ < text_.size() && text_[position_] == expected) {
      ++position_;
      return true;
    }
    return false;
  }

  void SkipWhitespace() {
    while (position_ < text_.size() && (text_[position_] == ' ' || text_[position_] == '\t' ||
                                        text_[position_] == '\n' || text_[position_] == '\r')) {
      ++position_;
    }
  }

  std::string_view text_;
  std::size_t position_ = 0;
};

}  // namespace

const Object* Value::AsObject() const {
  const auto* object = std::get_if<std::shared_ptr<Object>>(&storage_);
  return object != nullptr ? object->get() : nullptr;
}

std::optional<bool> Value::AsBool() const {
  const auto* value = std::get_if<bool>(&storage_);
  return value != nullptr ? std::optional<bool>(*value) : std::nullopt;
}

std::optional<std::int64_t> Value::AsInt() const {
  const auto* value = std::get_if<double>(&storage_);
  if (value == nullptr || std::isnan(*value) || std::isinf(*value)) {
    return std::nullopt;
  }
  if (*value < static_cast<double>(std::numeric_limits<std::int64_t>::min()) ||
      *value > static_cast<double>(std::numeric_limits<std::int64_t>::max())) {
    return std::nullopt;
  }
  return static_cast<std::int64_t>(*value);
}

const std::string* Value::AsString() const { return std::get_if<std::string>(&storage_); }

std::optional<Value> Parse(std::string_view text) { return Parser(text).ParseDocument(); }

void AppendEscaped(std::string& out, std::string_view value) {
  out.push_back('"');
  for (const char character : value) {
    switch (character) {
      case '"':
        out.append("\\\"");
        break;
      case '\\':
        out.append("\\\\");
        break;
      case '\b':
        out.append("\\b");
        break;
      case '\f':
        out.append("\\f");
        break;
      case '\n':
        out.append("\\n");
        break;
      case '\r':
        out.append("\\r");
        break;
      case '\t':
        out.append("\\t");
        break;
      default:
        if (static_cast<unsigned char>(character) < 0x20) {
          std::array<char, 7> buffer{};
          std::snprintf(buffer.data(), buffer.size(), "\\u%04x",
                        static_cast<unsigned>(static_cast<unsigned char>(character)));
          out.append(buffer.data());
        } else {
          out.push_back(character);
        }
        break;
    }
  }
  out.push_back('"');
}

}  // namespace oppex::json
