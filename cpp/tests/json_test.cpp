#include "json.hpp"

#include <string>

#include "test_support.hpp"

namespace {

using oppex::json::Parse;

OPPEX_TEST(ParsesAFlatObject) {
  const auto value = Parse(R"({"success":true,"code":201,"message":"created","data":"INC-1"})");
  OPPEX_ASSERT(value.has_value());

  const auto* object = value->AsObject();
  OPPEX_ASSERT(object != nullptr);
  OPPEX_ASSERT_EQ(true, object->at("success").AsBool().value());
  OPPEX_ASSERT_EQ(201, static_cast<int>(object->at("code").AsInt().value()));
  OPPEX_ASSERT_EQ(std::string("created"), *object->at("message").AsString());
  OPPEX_ASSERT_EQ(std::string("INC-1"), *object->at("data").AsString());
}

OPPEX_TEST(SkipsNestedValuesItDoesNotNeed) {
  const auto value = Parse(R"({"data":"INC-2","extra":{"a":[1,2,{"b":null}]},"code":200})");
  OPPEX_ASSERT(value.has_value());

  const auto* object = value->AsObject();
  OPPEX_ASSERT_EQ(std::string("INC-2"), *object->at("data").AsString());
  OPPEX_ASSERT_EQ(200, static_cast<int>(object->at("code").AsInt().value()));
}

OPPEX_TEST(ReadsEscapeSequences) {
  const auto value = Parse(R"({"m":"a \"quoted\" \\ line\nand\ttab é 😀"})");
  OPPEX_ASSERT(value.has_value());

  const std::string expected = "a \"quoted\" \\ line\nand\ttab \xc3\xa9 \xf0\x9f\x98\x80";
  OPPEX_ASSERT_EQ(expected, *value->AsObject()->at("m").AsString());
}

OPPEX_TEST(ReplacesALoneSurrogate) {
  const auto value = Parse(R"({"m":"\ud800"})");
  OPPEX_ASSERT(value.has_value());
  OPPEX_ASSERT_EQ(std::string("\xef\xbf\xbd"), *value->AsObject()->at("m").AsString());
}

OPPEX_TEST(RejectsMalformedDocuments) {
  for (const char* malformed : {"", "{", R"({"a"})", R"({"a":})", "[1,]", R"({"a":1}trailing)",
                                R"("unterminated)", "nul"}) {
    OPPEX_ASSERT(!Parse(malformed).has_value());
  }
}

OPPEX_TEST(RejectsARawControlCharacterInAString) {
  OPPEX_ASSERT(!Parse("{\"m\":\"a\nb\"}").has_value());
}

OPPEX_TEST(RejectsADocumentNestedPastTheDepthLimit) {
  // A hostile or broken proxy is exactly the source this parser reads from, so
  // deep nesting must fail rather than exhaust the stack.
  const std::string deep = std::string(200, '[') + std::string(200, ']');
  OPPEX_ASSERT(!Parse(deep).has_value());
}

OPPEX_TEST(EscapesOnTheWayOut) {
  std::string out;
  oppex::json::AppendEscaped(out, "a \"quoted\" \\ line\nwith\ttabs\x01");
  // Split so the expected six-character escape is written as text rather than
  // as an actual control byte in this source file.
  const std::string expected = std::string(R"("a \"quoted\" \\ line\nwith\ttabs)") + "\\u0001\"";
  OPPEX_ASSERT_EQ(expected, out);
}

OPPEX_TEST(EscapedTextRoundTrips) {
  const std::string original = "unicode \xc3\xa9 \xf0\x9f\x98\x80 and \"quotes\"";
  std::string document = R"({"m":)";
  oppex::json::AppendEscaped(document, original);
  document += "}";

  const auto value = Parse(document);
  OPPEX_ASSERT(value.has_value());
  OPPEX_ASSERT_EQ(original, *value->AsObject()->at("m").AsString());
}

OPPEX_TEST(ATypeMismatchReadsAsAbsent) {
  const auto value = Parse(R"({"success":"yes","code":"201","message":7,"data":[]})");
  OPPEX_ASSERT(value.has_value());

  const auto* object = value->AsObject();
  OPPEX_ASSERT(!object->at("success").AsBool().has_value());
  OPPEX_ASSERT(!object->at("code").AsInt().has_value());
  OPPEX_ASSERT(object->at("message").AsString() == nullptr);
  OPPEX_ASSERT(object->at("data").AsString() == nullptr);
}

}  // namespace
